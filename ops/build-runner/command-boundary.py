import ctypes
import json
import os
import platform
import sys


class SockFilter(ctypes.Structure):
    _fields_ = [
        ("code", ctypes.c_ushort),
        ("jt", ctypes.c_ubyte),
        ("jf", ctypes.c_ubyte),
        ("k", ctypes.c_uint32),
    ]


class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(SockFilter))]


def checked(result):
    if result < 0:
        raise OSError(ctypes.get_errno(), "builder filesystem boundary unavailable")
    return result


def restrict(workspace, home, executable):
    if platform.machine() not in ("x86_64", "aarch64"):
        raise RuntimeError("unsupported Landlock architecture")
    libc = ctypes.CDLL(None, use_errno=True)
    abi = checked(libc.syscall(444, 0, 0, 1))
    if abi < 3:
        raise RuntimeError("Landlock ABI 3 required")
    access = (1 << 15) - 1
    ruleset_attr = ctypes.c_uint64(access)
    ruleset = checked(libc.syscall(444, ctypes.byref(ruleset_attr), 8, 0))

    class PathRule(ctypes.Structure):
        _pack_ = 1
        _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int)]

    read = (1 << 0) | (1 << 2) | (1 << 3)
    files = ["/etc/ld.so.cache", "/etc/nsswitch.conf", "/etc/hosts", "/etc/resolv.conf", "/etc/localtime", "/etc/ssl/openssl.cnf"]
    paths = [(p, read) for p in ["/usr", "/bin", "/lib", "/lib64", "/etc/ssl/certs"]]
    paths += [(p, read & ~(1 << 3)) for p in files]
    paths += [(workspace, access)]
    paths += [(executable, (1 << 0) | (1 << 2))]
    paths += [(p, (1 << 1) | (1 << 2)) for p in ["/dev/null", "/dev/urandom", "/dev/random"]]
    for path, rights in paths:
        if not os.path.exists(path):
            continue
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        try:
            rule = PathRule(rights, fd)
            checked(libc.syscall(445, ruleset, 1, ctypes.byref(rule), 0))
        finally:
            os.close(fd)
    checked(libc.prctl(38, 1, 0, 0, 0))
    checked(libc.syscall(446, ruleset, 0))
    os.close(ruleset)
    socket_syscall, connect_syscall = {
        "x86_64": (41, 42),
        "aarch64": (198, 203),
    }[platform.machine()]
    program = (SockFilter * 6)(
        SockFilter(0x20, 0, 0, 0),
        SockFilter(0x15, 0, 1, socket_syscall),
        SockFilter(0x06, 0, 0, 0x00050000 | 1),
        SockFilter(0x15, 0, 1, connect_syscall),
        SockFilter(0x06, 0, 0, 0x00050000 | 1),
        SockFilter(0x06, 0, 0, 0x7FFF0000),
    )
    checked(libc.prctl(22, 2, ctypes.byref(SockFprog(len(program), program))))


def contained_path(path, workspace):
    resolved = os.path.realpath(path)
    if os.path.commonpath((workspace, resolved)) != workspace:
        raise RuntimeError("builder command cwd is outside workspace")
    return resolved


if __name__ == "__main__":
    config = json.loads(sys.argv[1])
    try:
        workspace = os.path.realpath(config["workspace"])
        home = contained_path(config["home"], workspace)
        cwd = contained_path(config["cwd"], workspace)
        os.chdir(cwd)
        restrict(workspace, home, config["executable"])
        os.execve("/bin/bash", ["bash", "--noprofile", "--norc", "-c", sys.argv[2]], {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": config["home"],
            "TMPDIR": config["home"],
            "LANG": "C.UTF-8",
            "GIT_CONFIG_NOSYSTEM": "1",
        })
    except Exception:
        print("builder command refused: filesystem boundary unavailable", file=sys.stderr)
        sys.exit(126)
