"""Entry point for the timer-driven watchdog; separate from the graph process."""

from julia_graph.watchdog import main


if __name__ == '__main__':
    raise SystemExit(main())
