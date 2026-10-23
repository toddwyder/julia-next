# Morning host test reference

The rerunnable reference is morning-helper-reference.mjs in this directory. It is a copied historical test script, with its original paths. Do not execute it at those paths.

The sanitized request observer wraps the guarded globalThis.fetch installed by openRunner. It reads only JSON model, URL, method, HTTP status and refusal. It delegates unchanged to that guarded function, so the connection core still owns dispatch and charging.

Stock subagent_start events contain agentType and modelId. Stock subagent_end events contain agentType, isError and result. Validate those fields directly. The prior real Beam test used the same CommandCode provider for Beam and DeepSeek. It did not use api.deepseek.com or another API key. The DeepSeek wire model was deepseek/deepseek-v4.1-flash. Its refused full ID was commandcode-free/deepseek/deepseek-v4.1-flash. The error was Trial forbids nonzero model prices. No DeepSeek HTTP status occurred and no paid call was sent.
