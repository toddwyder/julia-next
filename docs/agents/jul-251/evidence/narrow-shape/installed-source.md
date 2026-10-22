# Installed source evidence

Line numbers below belong to the original installed files; excerpts are not edited.

## @mastra/code-sdk@1.14.0 / dist/agents/model.js

SHA-256: `c13610dcef68e30aa439811e517a9c4c176c1c88f1f502b7fb35453504726aa7`

```text
72: }
73: /**
74: * Resolve a model ID to the correct provider instance.
75: * Shared by the main agent, observer, and reflector.
76: *
77: * - For anthropic/* models: Uses stored OAuth credentials when present, otherwise direct API key
78: * - For openai/* models: Uses OAuth when configured, otherwise direct API key from AuthStorage
79: * - For moonshotai/* models: Uses Moonshot AI Anthropic-compatible endpoint
80: * - For all other providers: Uses Mastra's model router (models.dev gateway)
81: */
82: function resolveModel(modelId, options) {
```

```text
114: function resolveModelForRequest(modelId, options) {
115: 	reloadAuthStorage();
116: 	const headers = getAgentControllerHeaders(options?.requestContext);
117: 	const settings = loadSettings();
118: 	const legacyNormalizedInput = normalizeLegacyModelId(modelId);
119: 	const customProviders = resolveCustomProviders(options?.requestContext) ?? settings.customProviders;
120: 	const normalizedInput = stripMastraCodeCustomProviderPrefix(legacyNormalizedInput, customProviders);
121: 	const isMastraGatewayModel = normalizedInput.startsWith(MASTRA_GATEWAY_PREFIX);
122: 	const normalizedModelId = stripMastraGatewayPrefix(normalizedInput);
123: 	const [providerId, ...modelParts] = normalizedModelId.split("/");
124: 	const bareModelId = modelParts.join("/");
125: 	if (!providerId || !bareModelId) throw new Error(`Invalid model id: ${modelId}`);
126: 	const tenantCredentialStore = resolveCredentialStore(options?.requestContext);
127: 	const baseCredentialStore = tenantCredentialStore ?? getGlobalAuthStorage();
128: 	if (providerId === "amazon-bedrock") {
129: 		if (tenantCredentialStore?.allowEnvironmentFallback === false && !tenantCredentialStore.allowsDeploymentCredentials?.("amazon-bedrock")) throw new ProviderAuthRequiredError("Amazon Bedrock is not enabled for this Factory deployment. The operator must provide AWS credentials to the server and set FACTORY_DEPLOYMENT_MODEL_PROVIDERS=amazon-bedrock.");
130: 		const bedrockGateway = createAmazonBedrockGateway();
131: 		const routerId = `${AMAZON_BEDROCK_GATEWAY_ID}/${bareModelId}`;
132: 		const auth = bedrockGateway.resolveAuth({
133: 			gatewayId: AMAZON_BEDROCK_GATEWAY_ID,
134: 			providerId: AMAZON_BEDROCK_GATEWAY_ID,
135: 			modelId: bareModelId,
136: 			routerId
137: 		});
138: 		return bedrockGateway.resolveLanguageModel({
139: 			providerId: AMAZON_BEDROCK_GATEWAY_ID,
140: 			modelId: bareModelId,
141: 			apiKey: auth?.apiKey ?? "",
142: 			headers
143: 		});
144: 	}
145: 	const routerId = `${MASTRACODE_GATEWAY_ID}/${normalizedModelId}`;
146: 	const mgApiKey = MastraCodeGateway.getMastraGatewayApiKey();
147: 	const rawGatewayBase = settings.memoryGateway?.baseUrl ?? process.env["MASTRA_GATEWAY_URL"] ?? "https://gateway-api.mastra.ai";
148: 	const credentialStore = createRequestScopedCredentialStore(baseCredentialStore, options?.requestContext);
149: 	const gateway = createMastraCodeGateway({
150: 		mastraGatewayBaseUrl: rawGatewayBase.replace(/\/+$/, "").replace(/\/v1$/, ""),
151: 		mastraGatewayApiKey: mgApiKey,
152: 		routeThroughMastraGateway: Boolean(mgApiKey && isMastraGatewayModel),
153: 		thinkingLevel: options?.thinkingLevel,
154: 		anthropicPromptCacheScope: options?.anthropicPromptCacheScope,
155: 		customProviders,
156: 		credentialStore
157: 	});
158: 	const auth = gateway.resolveAuth({
159: 		gatewayId: MASTRACODE_GATEWAY_ID,
160: 		providerId,
161: 		modelId: bareModelId,
162: 		routerId
163: 	});
164: 	if (!auth && credentialStore?.allowEnvironmentFallback === false) throw new ProviderAuthRequiredError(resolveCredentialScope(options?.requestContext) === "factory" ? `No usable ${providerId} credential is available. This Factory uses organization credentials only, so personal provider sign-ins don't apply. Add an organization credential, then try again.` : `No usable ${providerId} credential is available. This Factory uses personal credentials only, so organization credentials don't apply. Connect the provider, then try again.`);
165: 	return gateway.resolveLanguageModel({
166: 		providerId,
167: 		modelId: bareModelId,
168: 		apiKey: auth?.apiKey ?? "",
169: 		headers
```

## @mastra/code-sdk@1.14.0 / dist/agents/mastracode-gateway.js

SHA-256: `76bbf1b19a8d3067a88bca8f523dd1038f7e0152a90094a98542a859a74eb56b`

```text
43: * Resolve the Anthropic API key.
44: * Main slot → dedicated apikey: slot → env var.
45: */
46: function getAnthropicApiKey(credentials = getGlobalAuthStorage()) {
47: 	const storedCred = credentials.get("anthropic");
48: 	if (storedCred?.type === "api_key" && storedCred.key.trim().length > 0) return storedCred.key.trim();
49: 	const dedicatedKey = credentials.getStoredApiKey("anthropic")?.trim();
50: 	if (dedicatedKey) return dedicatedKey;
51: 	return credentials.allowEnvironmentFallback === false ? void 0 : process.env.ANTHROPIC_API_KEY?.trim() || void 0;
52: }
53: /**
54: * Resolve the OpenAI API key.
55: * Main slot → dedicated apikey: slot → env var.
56: */
57: function getOpenAIApiKey(credentials = getGlobalAuthStorage()) {
58: 	const storedCred = credentials.get("openai-codex");
59: 	if (storedCred?.type === "api_key" && storedCred.key.trim().length > 0) return storedCred.key.trim();
60: 	const dedicatedKey = credentials.getStoredApiKey("openai-codex")?.trim();
61: 	if (dedicatedKey) return dedicatedKey;
62: 	return credentials.allowEnvironmentFallback === false ? void 0 : process.env.OPENAI_API_KEY?.trim() || void 0;
63: }
64: function anthropicApiKeyProvider(modelId, apiKey, headers, thinkingLevel, promptCacheScope) {
65: 	const anthropic = createAnthropic({
66: 		apiKey,
67: 		headers
68: 	});
69: 	const thinkingMiddleware = createAnthropicThinkingMiddleware(modelId, thinkingLevel);
70: 	return wrapLanguageModel({
71: 		model: anthropic(modelId),
72: 		middleware: [createPromptCacheMiddleware(promptCacheScope), ...thinkingMiddleware ? [thinkingMiddleware] : []]
73: 	});
74: }
75: function openaiApiKeyProvider(modelId, apiKey, headers, thinkingLevel) {
76: 	const openai = createOpenAI({
77: 		apiKey,
78: 		baseURL: process.env.OPENAI_BASE_URL,
79: 		headers
80: 	});
81: 	const middleware = thinkingLevel && thinkingLevel !== "off" ? createReasoningEffortMiddleware("openai", THINKING_LEVEL_TO_REASONING_EFFORT[getEffectiveThinkingLevel(modelId, thinkingLevel)]) : void 0;
82: 	return wrapLanguageModel({
83: 		model: openai.responses(modelId),
84: 		middleware: middleware ? [middleware] : []
85: 	});
86: }
```

```text
287: 	}
288: 	resolveLanguageModel(args) {
289: 		const customProvider = this.#getCustomProviders().find((provider) => args.providerId === getCustomProviderId(provider.name));
290: 		if (customProvider) {
291: 			const provider = createOpenAICompatible({
292: 				name: args.providerId,
293: 				baseURL: customProvider.url,
294: 				apiKey: args.apiKey,
295: 				headers: args.headers
296: 			});
297: 			const reasoningEffort = this.#thinkingLevel ? THINKING_LEVEL_TO_REASONING_EFFORT[this.#thinkingLevel] : void 0;
298: 			const middleware = createReasoningEffortMiddleware(args.providerId, reasoningEffort);
299: 			if (!middleware) return provider.chatModel(args.modelId);
300: 			return wrapLanguageModel({
301: 				model: provider.chatModel(args.modelId),
302: 				middleware: [middleware]
303: 			});
304: 		}
305: 		if (args.providerId === "github-copilot") return githubCopilotProvider(args.modelId, {
306: 			headers: args.headers,
```

```text
381: 			promptCacheScope: this.#anthropicPromptCacheScope
382: 		});
383: 	}
384: 	#resolveOpenAIModel(args) {
385: 		const storedCred = this.#credentials.get("openai-codex");
386: 		if (this.#routeThroughMastraGateway) {
387: 			if (storedCred?.type === "oauth") {
388: 				const resolvedBareModelId = remapOpenAIModelForCodexOAuth(`openai/${args.modelId}`).substring(OPENAI_PREFIX.length);
389: 				const reasoningEffort = THINKING_LEVEL_TO_REASONING_EFFORT[getEffectiveThinkingLevel(args.modelId, this.#thinkingLevel ?? "medium")];
390: 				const middleware = createCodexMiddleware(reasoningEffort);
391: 				return wrapLanguageModel({
392: 					model: createOpenAI({
393: 						apiKey: "oauth-gateway-placeholder",
394: 						baseURL: `${this.#mastraGatewayBaseUrl}/v1`,
395: 						headers: {
396: 							[GATEWAY_AUTH_HEADER]: `Bearer ${args.apiKey}`,
397: 							...args.headers
398: 						},
399: 						fetch: buildOpenAICodexOAuthFetch({
400: 							authStorage: this.#credentials,
401: 							rewriteUrl: false
402: 						})
403: 					}).responses(resolvedBareModelId),
404: 					middleware: [middleware]
405: 				});
406: 			}
407: 			return this.#mastraGateway.resolveLanguageModel(args);
408: 		}
409: 		if (storedCred?.type === "oauth") return openaiCodexProvider(remapOpenAIModelForCodexOAuth(`openai/${args.modelId}`).substring(OPENAI_PREFIX.length), {
410: 			thinkingLevel: this.#thinkingLevel && getEffectiveThinkingLevel(args.modelId, this.#thinkingLevel),
411: 			headers: args.headers,
412: 			authStorage: this.#credentials
413: 		});
414: 		const apiKey = getOpenAIApiKey(this.#credentials);
415: 		if (apiKey) return openaiApiKeyProvider(args.modelId, apiKey, args.headers, this.#thinkingLevel);
416: 	}
417: 	#resolveGoogleModel(args) {
418: 		const routerModel = new ModelRouterLanguageModel({
419: 			id: `${args.providerId}/${args.modelId}`,
420: 			apiKey: args.apiKey,
421: 			headers: args.headers
422: 		});
423: 		const thinkingMiddleware = createGoogleThinkingMiddleware(args.modelId, this.#thinkingLevel);
424: 		if (!thinkingMiddleware) return routerModel;
425: 		return wrapLanguageModel({
```

## @mastra/code-sdk@1.14.0 / dist/auth/storage.js

SHA-256: `940539574c54b2ac24b86c2841d4023c71a949f3dcda41f554d7b914a72829e5`

```text
101: 	constructor(authPath = join(getAppDataDir(), "auth.json")) {
102: 		this.authPath = authPath;
103: 		this.reload();
104: 	}
105: 	/**
106: 	* Reload credentials from disk.
107: 	*/
108: 	reload() {
109: 		if (!existsSync(this.authPath)) {
110: 			this.data = {};
111: 			return;
112: 		}
```

```text
226: 	*/
227: 	save() {
228: 		const dir = dirname(this.authPath);
229: 		if (!existsSync(dir)) mkdirSync(dir, {
230: 			recursive: true,
231: 			mode: 448
232: 		});
233: 		const tempPath = `${this.authPath}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`;
234: 		try {
235: 			writeFileSync(tempPath, JSON.stringify(this.data, null, 2), {
236: 				encoding: "utf-8",
237: 				mode: 384
238: 			});
239: 			chmodSync(tempPath, 384);
240: 			renameSync(tempPath, this.authPath);
241: 		} finally {
242: 			rmSync(tempPath, { force: true });
243: 		}
244: 	}
245: 	/**
246: 	* Get credential for a provider. Registry entries (type 'oauth-account')
247: 	* live under `accounts:` keys and never surface here.
248: 	*/
249: 	get(provider) {
250: 		const cred = this.data[provider];
251: 		return cred !== void 0 && cred.type !== "oauth-account" ? cred : void 0;
252: 	}
253: 	/**
254: 	* Set credential for a provider.
255: 	*/
256: 	set(provider, credential) {
257: 		this.reload();
258: 		this.data[provider] = credential;
259: 		this.save();
260: 	}
261: 	/**
262: 	* Remove credential for a provider, including its account registry.
263: 	* Clearing only the slot would leave the registry behind, and the next
264: 	* load's migration would heal the slot back from it — resurrecting the
265: 	* provider the caller just signed out.
266: 	*/
267: 	remove(provider) {
```

```text
301: 	* Get a stored API key for a provider, if any.
302: 	*/
303: 	getStoredApiKey(provider) {
304: 		const cred = this.data[`apikey:${provider}`];
305: 		return cred?.type === "api_key" && cred.key.length > 0 ? cred.key : void 0;
306: 	}
307: 	/**
308: 	* Store an API key for a provider.
309: 	* Also sets the corresponding environment variable so model resolution can find it.
310: 	*/
311: 	setStoredApiKey(provider, key, envVar) {
312: 		this.set(`apikey:${provider}`, {
313: 			type: "api_key",
314: 			key
315: 		});
316: 		if (envVar) process.env[envVar] = key;
317: 	}
318: 	/**
319: 	* Load all stored API keys into process.env.
320: 	* Called at startup so model resolution can find stored keys.
321: 	* Only sets env vars that aren't already set (env vars take precedence).
322: 	*/
323: 	loadStoredApiKeysIntoEnv(providerEnvVars) {
324: 		for (const [key, cred] of Object.entries(this.data)) {
325: 			if (!key.startsWith("apikey:") || cred.type !== "api_key" || !cred.key) continue;
326: 			const envVar = providerEnvVars[key.substring(7)];
327: 			if (envVar && !process.env[envVar]) process.env[envVar] = cred.key;
328: 		}
329: 	}
330: 	/**
331: 	* Login to an OAuth provider. Resolves to the registered account record.
332: 	* Pass `activate: false` to add the account without making it active (the
333: 	* first account for a provider is always activated — a provider with
334: 	* accounts must have an active one).
335: 	*/
336: 	async login(providerId, callbacks, opts) {
337: 		const provider = getOAuthProvider(providerId);
338: 		if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
339: 		const credentials = await provider.login(callbacks);
340: 		return this.addAccount(providerId, credentials, opts);
341: 	}
342: 	/**
```

```text
655: 			} catch {
656: 				return;
657: 			}
658: 		})();
659: 		this.refreshPromises.set(refreshKey, refresh);
660: 		try {
661: 			return await refresh;
662: 		} finally {
663: 			this.refreshPromises.delete(refreshKey);
664: 		}
665: 	}
666: 	/**
667: 	* Get a ready-to-use OAuth credential snapshot, auto-refreshing if needed.
668: 	* A failed refresh leaves the active account unchanged and returns undefined;
669: 	* the account-rotation processor owns switching so it can persist a visible
670: 	* account-switch notice with the request that triggered the change.
671: 	*/
672: 	async getOAuthCredential(providerId, accountInstanceId) {
673: 		this.reload();
674: 		const activeEntry = this.getActiveAccount(providerId);
675: 		const selectedEntry = accountInstanceId ? this.accountEntries(providerId).find((entry) => entry.id === accountInstanceId) : activeEntry;
676: 		const slot = this.data[providerId];
677: 		let credential;
678: 		if (selectedEntry) {
679: 			const { type: _type, id: _id, label: _label, addedAt: _addedAt, active: _active, ...accountCredential } = selectedEntry;
680: 			credential = accountCredential;
681: 			if (selectedEntry.active && slot?.type === "oauth" && slot.refresh === selectedEntry.refresh) {
682: 				const { type: _slotType, ...slotCredential } = slot;
683: 				credential = {
684: 					...credential,
685: 					...slotCredential
686: 				};
687: 			}
688: 		} else if (!accountInstanceId && slot?.type === "oauth") credential = slot;
689: 		if (!credential) return void 0;
690: 		const provider = getOAuthProvider(providerId);
691: 		if (!provider) return void 0;
692: 		const selectedInstanceId = selectedEntry?.id;
693: 		const toSnapshot = (credentials) => ({
694: 			type: "oauth",
695: 			...credentials,
696: 			accountInstanceId: selectedInstanceId
697: 		});
698: 		if (Date.now() < credential.expires) return toSnapshot(credential);
699: 		if (selectedInstanceId) {
700: 			const refreshed = await this.refreshInstance(providerId, selectedInstanceId, credential);
701: 			return refreshed ? toSnapshot(refreshed) : void 0;
702: 		}
703: 		const pendingRefresh = this.refreshPromises.get(providerId);
704: 		const refresh = pendingRefresh ?? (async () => {
705: 			try {
706: 				const fresh = await provider.refreshToken(credential);
707: 				this.persistRefreshedCredential(providerId, void 0, fresh);
708: 				return fresh;
709: 			} catch {
710: 				return;
711: 			}
712: 		})();
713: 		if (!pendingRefresh) this.refreshPromises.set(providerId, refresh);
714: 		try {
715: 			const refreshed = await refresh;
716: 			return refreshed ? toSnapshot(refreshed) : void 0;
717: 		} finally {
718: 			if (!pendingRefresh) this.refreshPromises.delete(providerId);
719: 		}
720: 	}
721: 	/** Get API key for a provider, refreshing OAuth tokens if needed. */
722: 	async getApiKey(providerId, accountInstanceId) {
723: 		this.reload();
724: 		const cred = this.data[providerId];
725: 		if (accountInstanceId === void 0 && cred?.type === "api_key") return cred.key;
726: 		const oauth = await this.getOAuthCredential(providerId, accountInstanceId);
727: 		const provider = oauth ? getOAuthProvider(providerId) : void 0;
728: 		return oauth && provider ? provider.getApiKey(oauth) : void 0;
729: 	}
730: 	/**
731: 	* Force one refresh of the active OAuth account's tokens, regardless of
732: 	* expiry. The account-rotation error processor calls this when a provider
733: 	* rejects a not-yet-expired token (401/403) — server-side clock skew and
734: 	* refresh-token races surface that way. Returns the fresh access token, or
735: 	* undefined when the refresh fails or there is no OAuth credential.
736: 	* Shares the per-instance refresh dedupe with `getApiKey`.
737: 	*/
738: 	async forceRefreshActiveAccount(providerId, accountInstanceId) {
739: 		this.reload();
740: 		const activeEntry = this.getActiveAccount(providerId);
741: 		const selectedEntry = accountInstanceId ? this.accountEntries(providerId).find((entry) => entry.id === accountInstanceId) : activeEntry;
742: 		const slot = this.get(providerId);
743: 		let cred;
744: 		if (selectedEntry) {
745: 			const { type: _type, id: _id, label: _label, addedAt: _addedAt, active: _active, ...accountCredential } = selectedEntry;
746: 			cred = accountCredential;
```

## @mastra/code-sdk@1.14.0 / dist/auth/types.d.ts

SHA-256: `0b46c59614f1a156eb952ed77427f41a0915f81e8337830112b93cd19235daa0`

```text
1: /**
2:  * OAuth types for authentication providers
3:  */
4: export interface OAuthCredentials {
5:     refresh: string;
6:     access: string;
7:     expires: number;
8:     [key: string]: unknown;
9: }
10: export type OAuthProviderId = string;
```

```text
118:  */
119: export interface CredentialStore {
120:     /** Whether model resolution may fall back to process environment credentials. */
121:     readonly allowEnvironmentFallback?: boolean;
122:     /**
123:      * Whether `provider` may authenticate with credentials the server process
124:      * supplies (an operator opt-in), even when `allowEnvironmentFallback` is
125:      * false. Used by gateways whose auth is process-scoped by design, such as
126:      * Amazon Bedrock's AWS credential chain.
127:      */
128:     allowsDeploymentCredentials?(provider: string): boolean;
129:     /** Refresh any cached view (no-op for sources that are always fresh). */
130:     reload(): void;
131:     /** Credential in the provider's main slot (`anthropic`, `openai-codex`, …). */
132:     get(provider: string): AuthCredential | undefined;
133:     /** Dedicated stored API key for a provider, if any. */
134:     getStoredApiKey(provider: string): string | undefined;
135:     /**
136:      * Ready-to-use key/token for a provider, refreshing expired OAuth
137:      * credentials first. Implementations own refresh serialization.
138:      */
139:     getApiKey(provider: string, accountInstanceId?: string): Promise<string | undefined>;
140:     /**
141:      * Ready-to-use OAuth credential snapshot. Optional because deployed stores
142:      * have no local account registry. Local wrappers use this to keep the access
143:      * token and account-specific metadata from the same account.
144:      */
145:     getOAuthCredential?(provider: string, accountInstanceId?: string): Promise<OAuthCredentialSnapshot | undefined>;
146:     /**
147:      * Registered OAuth accounts for a provider, in insertion order. Optional so
148:      * deployed per-tenant stores need no change.
149:      */
150:     listAccounts?(providerId: string): OAuthAccountRecord[];
151:     /** The provider's active registry entry, if a registry exists. */
152:     getActiveAccount?(providerId: string): OAuthAccountRecord | undefined;
```

## @mastra/code-sdk@1.14.0 / dist/auth/providers/openai-codex.js

SHA-256: `7f2f436fa7d4b9b170c2bb7505c2fa7033f796c1be46829700493510e0c8c3c3`

```text
132: async function refreshAccessToken(refreshToken) {
133: 	try {
134: 		const response = await fetch(TOKEN_URL, {
135: 			method: "POST",
136: 			signal: requestSignal(),
137: 			headers: { "Content-Type": "application/x-www-form-urlencoded" },
138: 			body: new URLSearchParams({
139: 				grant_type: "refresh_token",
140: 				refresh_token: refreshToken,
141: 				client_id: CLIENT_ID
142: 			})
143: 		});
144: 		if (!response.ok) {
145: 			console.error("[openai-codex] Token refresh failed:", response.status);
146: 			return { type: "failed" };
147: 		}
148: 		return tokenResponseToResult(await response.json(), "Token refresh");
149: 	} catch {
150: 		console.error("[openai-codex] Token refresh request failed");
151: 		return { type: "failed" };
152: 	}
153: }
```

```text
280: /**
281: * Start a Codex device-code login: request a user code and return the
282: * serializable pending state for subsequent polls.
283: */
284: async function startCodexDeviceLogin(options) {
285: 	const response = await fetch(DEVICE_USER_CODE_URL, {
286: 		method: "POST",
287: 		headers: {
288: 			"Content-Type": "application/json",
289: 			"User-Agent": "mastracode"
290: 		},
291: 		body: JSON.stringify({
292: 			client_id: CLIENT_ID,
293: 			originator: "mastracode"
294: 		}),
295: 		signal: requestSignal(options?.signal)
296: 	});
297: 	if (!response.ok) throw new Error(`Failed to initiate OpenAI Codex device authorization: ${response.status}`);
298: 	const deviceData = await response.json();
299: 	const userCode = deviceData.user_code ?? deviceData.usercode;
300: 	if (!deviceData.device_auth_id || !userCode) throw new Error("OpenAI Codex device authorization response missing required fields");
301: 	const intervalSeconds = typeof deviceData.interval === "number" ? deviceData.interval : Number.parseInt(deviceData.interval ?? "", 10) || 5;
302: 	return {
303: 		deviceAuthId: deviceData.device_auth_id,
304: 		userCode,
305: 		url: DEVICE_AUTHORIZE_URL,
306: 		instructions: `Enter code: ${userCode}`,
307: 		intervalMs: Math.max(intervalSeconds, 1) * 1e3,
308: 		deadlineAt: Date.now() + DEVICE_AUTH_TIMEOUT_MS
309: 	};
310: }
```

```text
403: async function loginOpenAICodex(options) {
404: 	const envMode = typeof process !== "undefined" && process.env?.MASTRACODE_OPENAI_CODEX_AUTH_MODE === "device" ? "device" : void 0;
405: 	if ((options.mode ?? envMode ?? "browser") === "device") return loginOpenAICodexDevice({
406: 		onAuth: options.onAuth,
407: 		onProgress: options.onProgress,
408: 		signal: options.signal
409: 	});
410: 	const state = await createState();
411: 	const server = await startLocalOAuthServer(state);
412: 	if (server.warning) options.onProgress?.(server.warning);
413: 	const { verifier, url } = await createAuthorizationFlow(server.redirectUri, state, options.originator ?? "mastracode");
414: 	options.onAuth({
415: 		url,
416: 		instructions: server.warning ? `${server.warning} You can still paste the authorization code or full redirect URL manually.` : "A browser window should open. Complete login to finish."
417: 	});
418: 	let code;
419: 	try {
```

```text
480: /**
481: * Refresh OpenAI Codex OAuth token
482: */
483: async function refreshOpenAICodexToken(refreshToken, previousAccountId, previousEmail) {
484: 	const result = await refreshAccessToken(refreshToken);
485: 	if (result.type !== "success") throw new Error("Failed to refresh OpenAI Codex token");
486: 	const accountId = requireAccountId(result, previousAccountId);
487: 	return {
488: 		access: result.access,
489: 		refresh: result.refresh,
490: 		expires: result.expires,
491: 		accountId,
492: 		email: getEmailFromTokens(result) ?? previousEmail
493: 	};
494: }
495: const openaiCodexOAuthProvider = {
496: 	id: "openai-codex",
497: 	name: "ChatGPT Plus/Pro (Codex Subscription)",
498: 	usesCallbackServer: true,
499: 	authModes: OPENAI_CODEX_AUTH_MODES,
500: 	async login(callbacks) {
501: 		const mode = callbacks.authMode === "device" || callbacks.authMode === "browser" ? callbacks.authMode : void 0;
502: 		return loginOpenAICodex({
503: 			onAuth: callbacks.onAuth,
504: 			onPrompt: callbacks.onPrompt,
505: 			onProgress: callbacks.onProgress,
506: 			onManualCodeInput: callbacks.onManualCodeInput,
507: 			signal: callbacks.signal,
508: 			mode
509: 		});
510: 	},
511: 	async refreshToken(credentials) {
512: 		return refreshOpenAICodexToken(credentials.refresh, credentials.accountId, credentials.email);
513: 	},
514: 	getApiKey(credentials) {
515: 		return credentials.access;
516: 	},
```

## @mastra/code-sdk@1.14.0 / dist/providers/openai-codex.js

SHA-256: `f92e148ee304001e3900ba34af373e0379b3acb535b6ba90d07ada9baa7c886f`

```text
95: 	};
96: }
97: /**
98: * Get a live OAuth bearer token for the Codex OAuth credential.
99: *
100: * Refreshes the token if it's expired, and returns the credential's
101: * accountId alongside the access token. Throws if the user isn't logged in
102: * or if the refresh fails.
103: *
104: * This is the only piece of Codex auth that is genuinely shared between
105: * the main agent's fetch (`buildOpenAICodexOAuthFetch`) and the Stagehand
106: * fetch (`buildCodexStagehandFetch`).
107: */
108: async function getCodexBearer(authStorage) {
109: 	const storage = authStorage ?? getAuthStorage();
110: 	storage.reload();
111: 	let cred = storage.get("openai-codex");
112: 	if (!cred || cred.type !== "oauth") throw new ProviderAuthRequiredError("Not logged in to OpenAI Codex.");
113: 	if (storage.getOAuthCredential) {
114: 		cred = await storage.getOAuthCredential("openai-codex");
115: 		if (!cred) throw new ProviderAuthRequiredError("Failed to refresh the OpenAI Codex token.");
116: 	} else if (Date.now() >= cred.expires) {
117: 		const refreshedToken = await storage.getApiKey("openai-codex");
118: 		if (!refreshedToken) throw new ProviderAuthRequiredError("Failed to refresh the OpenAI Codex token.");
119: 		storage.reload();
120: 		const reloaded = storage.get("openai-codex");
121: 		if (!reloaded || reloaded.type !== "oauth") throw new ProviderAuthRequiredError("Not logged in to OpenAI Codex.");
122: 		cred = {
123: 			...reloaded,
124: 			access: refreshedToken
125: 		};
126: 	}
127: 	return {
128: 		accessToken: cred.access,
129: 		accountId: cred.accountId
130: 	};
131: }
```

```text
141: 		const { accessToken, accountId } = await getCodexBearer(opts.authStorage);
142: 		const { headers: initHeaders, ...requestInit } = init ?? {};
143: 		const request = new Request(url, requestInit);
144: 		const headers = new Headers(url instanceof Request ? url.headers : void 0);
145: 		if (initHeaders) new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
146: 		headers.delete("authorization");
147: 		headers.delete("x-api-key");
148: 		headers.set("Authorization", `Bearer ${accessToken}`);
149: 		if (!headers.has("originator")) headers.set("originator", CODEX_ORIGINATOR);
150: 		if (!headers.has("User-Agent")) headers.set("User-Agent", CODEX_USER_AGENT);
151: 		if (accountId) headers.set("ChatGPT-Account-ID", accountId);
152: 		const parsed = new URL(request.url);
153: 		const finalUrl = opts.rewriteUrl !== false && (parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")) ? new URL(CODEX_API_ENDPOINT) : parsed;
154: 		const body = request.method === "GET" || request.method === "HEAD" ? void 0 : request.body;
155: 		const finalRequest = new Request(finalUrl, {
156: 			method: request.method,
157: 			headers,
158: 			body,
159: 			signal: request.signal,
160: 			redirect: request.redirect,
161: 			integrity: request.integrity,
162: 			...body ? { duplex: "half" } : {}
163: 		});
164: 		try {
165: 			return await rejectUnauthorizedResponse(await fetch(finalRequest), {
166: 				providerName: "OpenAI Codex",
167: 				requestUrl: finalUrl.toString()
168: 			});
169: 		} catch (error) {
170: 			if (error && typeof error === "object") Object.assign(error, { requestUrl: finalUrl.toString() });
171: 			throw error;
172: 		}
173: 	});
174: }
175: /**
176: * Build a fetch function for Stagehand-on-Codex.
177: *
178: * The Codex backend has two requirements that AI SDK's non-streaming
179: * `generateText` path doesn't naturally satisfy:
180: *
181: *   1. `stream: true` must be set on every request body.
182: *   2. The response is delivered as Server-Sent Events; AI SDK's
```

## @mastra/code-sdk@1.14.0 / dist/utils/project.js

SHA-256: `7ea3d18d53f99c8a7535547d0c955b27eec8deb79917fc9a53089ee2bad2254d`

```text
125: }
126: /**
127: * Get the application data directory for mastracode
128: * - macOS: ~/Library/Application Support/mastracode
129: * - Linux: ~/.local/share/mastracode
130: * - Windows: %APPDATA%/mastracode
131: */
132: function getAppDataDir() {
133: 	if (process.env.MASTRA_APP_DATA_DIR) {
134: 		fs.mkdirSync(process.env.MASTRA_APP_DATA_DIR, { recursive: true });
135: 		return process.env.MASTRA_APP_DATA_DIR;
136: 	}
137: 	const platform = os.platform();
138: 	let baseDir;
139: 	if (platform === "darwin") baseDir = path.join(os.homedir(), "Library", "Application Support");
140: 	else if (platform === "win32") baseDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
141: 	else baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
142: 	const appDir = path.join(baseDir, "mastracode");
143: 	if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
144: 	return appDir;
145: }
146: /**
147: * Get the database path for mastracode
```

## @mastra/code-sdk@1.14.0 / dist/onboarding/settings.js

SHA-256: `743d59acc74525820c9941c6663d041cc94de4b0a19dab3a440a8d6eb03a6006`

```text
314: function getSettingsPath() {
315: 	return join(getAppDataDir(), "settings.json");
316: }
317: function getCustomProviderId(name) {
```

```text
835: function saveSettings(settings, filePath = getSettingsPath()) {
836: 	const dir = dirname(filePath);
837: 	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
838: 	const signals = getSignalSettingsForSave(settings, filePath);
839: 	settings.signals = signals;
840: 	loadedSignalSettings.set(settings, cloneSignalSettings(signals));
841: 	const settingsToSave = { ...settings };
842: 	delete settingsToSave._experimentalAgentSettingsPath;
843: 	writeFileAtomically(filePath, JSON.stringify(settingsToSave, null, 2));
844: }
845: /** Marker file name to track which provider last used a profile. */
846: const PROFILE_PROVIDER_MARKER = ".mastra-provider";
```

## @mastra/code-sdk@1.14.0 / dist/agents/credential-resolver.d.ts

SHA-256: `214feb0126481bb1307c65bc61c63471c74b3fc48ede1c740abc228432bc432e`

```text
31: export type CredentialStoreProvider = (tenant: CredentialTenant) => CredentialStore | undefined;
32: export type CredentialTenantResolver = (requestContext: RequestContext) => Promise<CredentialTenant | undefined>;
33: /** Register (or clear) the tenant credential store provider. Deployed-web only. */
34: export declare function setCredentialStoreProvider(provider: CredentialStoreProvider | undefined, resolveTenant?: CredentialTenantResolver): void;
35: /** Refresh authority before a fresh model invocation; cloned contexts inherit only an opaque token. */
36: export declare function prepareCredentialTenant(requestContext?: RequestContext): Promise<void>;
37: export declare function withCredentialTenantPreparation<T>(resolve: (ctx: {
38:     requestContext: RequestContext;
39: }) => T): (ctx: {
40:     requestContext: RequestContext;
41: }) => Promise<T>;
42: /**
43:  * Whether a tenant provider is registered. Used to disable the
44:  * `loadStoredApiKeysIntoEnv` side-channel in deployed mode — per-tenant
45:  * credentials must never leak into process-global env vars.
46:  */
47: export declare function hasCredentialStoreProvider(): boolean;
48: export declare function hasCredentialTenantResolver(): boolean;
49: export declare function resolveCredentialScope(requestContext?: RequestContext): CredentialScope;
50: /**
51:  * Derive the calling tenant from a request context, if an authenticated web
52:  * user was stashed on it. Mirrors the web layer's stable-id resolution
53:  * (`workosId` falling back to the provider `id`).
54:  *
55:  * Session state and HTTP-supplied policy values never establish credential authority.
56:  */
57: export declare function resolveTenantFromRequestContext(requestContext?: RequestContext): CredentialTenant | undefined;
58: /** Authenticated principal only, for hosts resolving durable session ownership. */
59: export declare function resolveAuthenticatedCredentialTenant(requestContext?: RequestContext): CredentialTenant | undefined;
60: /**
61:  * Resolve the credential store for a request. Local mode returns `undefined`
62:  * and keeps the global `AuthStorage` behavior. Once deployed web registers a
```

```text

```

## @mastra/code-sdk@1.14.0 / dist/agents/custom-provider-source.d.ts

SHA-256: `07830839dc15074572a60a18bc632dbeb61841b43d0145ca2da108cb2b8036fb`

```text
1: /**
2:  * Custom provider source seam for deployed (multi-user) servers.
3:  *
4:  * Locally, custom providers are read from the file-backed settings
5:  * (settings.json). A deployed web host registers a {@link CustomProvidersSource}
6:  * at boot; from then on model resolution and the gateway catalog read custom
7:  * providers through the source — DB-backed and tenant-scoped — and never touch
8:  * settings.json.
9:  *
10:  * When no source is registered (TUI, local web), everything falls through to
11:  * the existing settings-based behavior unchanged.
12:  */
13: import type { RequestContext } from '@mastra/core/request-context';
14: import type { CredentialTenant } from './credential-resolver.js';
15: import type { MastraCodeCustomProvider } from './mastracode-gateway.js';
16: /**
17:  * Returns the custom providers visible to the given tenant. `tenant` is
18:  * `undefined` for calls without an authenticated request (boot-time catalog,
19:  * local/no-auth mode) — implementations decide what that means (e.g. the
20:  * local sentinel org, or an empty list in tenant mode). Must be synchronous —
21:  * implementations serve from a primed snapshot.
22:  */
23: export type CustomProvidersSource = (tenant: CredentialTenant | undefined) => MastraCodeCustomProvider[];
24: /** Register (or clear) the custom providers source. Deployed-web only. */
25: export declare function setCustomProvidersSource(source: CustomProvidersSource | undefined): void;
26: /** Whether a custom providers source is registered. */
27: export declare function hasCustomProvidersSource(): boolean;
28: /**
29:  * Resolve custom providers for a request. Returns `undefined` when no source
30:  * is registered — callers fall back to settings.json. Once a source is
31:  * registered it is authoritative: its result (possibly empty) is used and
32:  * settings.json is never consulted.
33:  */
34: export declare function resolveCustomProviders(requestContext?: RequestContext): MastraCodeCustomProvider[] | undefined;
35: //# sourceMappingURL=custom-provider-source.d.ts.map
```

## @mastra/code-sdk@1.14.0 / dist/index.js

SHA-256: `0130afeaca903687d774691b9d33634bed74411afe0c1488c030db369ed05da8`

```text
250: 	if (!config?.disableEnvFile) try {
251: 		process.loadEnvFile(path.join(cwd, ".env"));
252: 	} catch {}
253: 	const authStorage = createAuthStorage();
254: 	const globalSettings = loadSettings(config?.settingsPath);
255: 	const experimentalAgent = resolveExperimentalAgent(globalSettings);
256: 	const backgroundToolsEnabled = globalSettings.backgroundTools?.enabled ?? false;
257: 	const storedGatewayKey = authStorage.getStoredApiKey(MASTRA_GATEWAY_PROVIDER);
258: 	const storedGatewayUrl = globalSettings.memoryGateway?.baseUrl;
259: 	if (storedGatewayKey) process.env["MASTRA_GATEWAY_API_KEY"] ??= storedGatewayKey;
260: 	if (storedGatewayUrl) process.env["MASTRA_GATEWAY_URL"] ??= storedGatewayUrl;
261: 	if (!hasCredentialStoreProvider()) try {
262: 		const registry = PROVIDER_REGISTRY;
263: 		const providerEnvVars = {};
264: 		for (const [provider, cfg] of Object.entries(registry)) {
265: 			const envVars = cfg?.apiKeyEnvVar;
266: 			providerEnvVars[provider] = Array.isArray(envVars) ? envVars[0] : envVars;
267: 		}
268: 		providerEnvVars[MASTRA_GATEWAY_PROVIDER] ??= "MASTRA_GATEWAY_API_KEY";
269: 		authStorage.loadStoredApiKeysIntoEnv(providerEnvVars);
270: 	} catch {
271: 		authStorage.loadStoredApiKeysIntoEnv({
272: 			[MASTRA_GATEWAY_PROVIDER]: "MASTRA_GATEWAY_API_KEY",
273: 			anthropic: "ANTHROPIC_API_KEY",
274: 			openai: "OPENAI_API_KEY",
275: 			google: "GOOGLE_GENERATIVE_AI_API_KEY",
276: 			cerebras: "CEREBRAS_API_KEY",
277: 			deepseek: "DEEPSEEK_API_KEY"
278: 		});
279: 	}
280: 	const mgApiKey = process.env["MASTRA_GATEWAY_API_KEY"] ?? storedGatewayKey;
```

## @mastra/code-sdk@1.14.0 / dist/headless/run-mc.js

SHA-256: `ea0d0ca05fd81753e7eaaf7ec7913f19722b4c0ff124986414c50c82d1f6d3e9`

```text
52: 				isError: event.isError
53: 			});
54: 			break;
55: 		}
56: 		case "usage_update":
57: 			acc.usage = {
58: 				inputTokens: event.usage.promptTokens,
59: 				outputTokens: event.usage.completionTokens,
60: 				totalTokens: event.usage.totalTokens
61: 			};
62: 			break;
63: 		case "error":
64: 			acc.error = {
```

## @mastra/core@1.78.0 / dist/agent-controller/types.d.ts

SHA-256: `95790dd965c36da847f33bd6acc424a5f516bc7f76e59c7849474d5be10dedbb`

```text
434: /**
435:  * Token usage statistics from the model.
436:  */
437: export interface TokenUsage {
438:     promptTokens: number;
439:     completionTokens: number;
440:     totalTokens: number;
441:     reasoningTokens?: number;
442:     cachedInputTokens?: number;
443:     cacheCreationInputTokens?: number;
444:     cacheCreationInputTokens5m?: number;
445:     cacheCreationInputTokens1h?: number;
446:     raw?: unknown;
447: }
448: /** Creates a zero-initialized TokenUsage object. */
449: export declare function createEmptyTokenUsage(): TokenUsage;
```

```text
758:     exitCode: number;
759:     success: boolean;
760: })) | {
761:     type: 'usage_update';
762:     usage: TokenUsage;
763: } | {
764:     type: 'info';
765:     message: string;
766: } | {
```

## @mastra/core@1.78.0 / dist/agent-controller-DRiP9C5v.js

SHA-256: `89187a550440d68c7a5f914c60aeba5a20a8d9316e4d0540e25ab99fb5e2e673`

```text
119: * Normalize a step's usage payload. Returns undefined when no primary count is
120: * present so an absent measurement is never reported as a measured zero.
121: */
122: function toStepTokenUsage(usage) {
123: 	if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return void 0;
124: 	const record = usage;
125: 	const rawPrompt = getUsageNumber(record, "promptTokens") ?? getUsageNumber(record, "inputTokens");
126: 	const rawCompletion = getUsageNumber(record, "completionTokens") ?? getUsageNumber(record, "outputTokens");
127: 	const rawTotal = getUsageNumber(record, "totalTokens");
128: 	if (rawPrompt === void 0 && rawCompletion === void 0 && rawTotal === void 0) return void 0;
129: 	const promptTokens = rawPrompt ?? 0;
130: 	const completionTokens = rawCompletion ?? 0;
131: 	const stepUsage = {
132: 		promptTokens,
133: 		completionTokens,
134: 		totalTokens: rawTotal ?? promptTokens + completionTokens
135: 	};
136: 	for (const key of OPTIONAL_USAGE_FIELDS) addOptionalUsageField$1(stepUsage, key, getUsageNumber(record, key));
137: 	if (record.raw !== void 0) stepUsage.raw = record.raw;
138: 	return stepUsage;
139: }
```

```text
1031: 				state.completedToolPrelude = state.offeredResponseIds.size === 0 && this.hasCurrentMessageContent(state) && state.currentMessage.content.parts.every((part) => part.type === "tool-invocation" && part.toolInvocation.state === "result");
1032: 				const stepUsage = toStepTokenUsage(getRecord(getPayload(chunk).output)?.usage);
1033: 				if (stepUsage) {
1034: 					const bindingGeneration = this.#session.run.bindingGeneration();
1035: 					let savedUsage;
1036: 					try {
1037: 						if (state.threadId) savedUsage = (await this.#session.thread.getById({ threadId: state.threadId }))?.metadata?.tokenUsage;
1038: 					} catch {
1039: 						break;
1040: 					}
1041: 					if (this.#session.run.bindingGeneration() !== bindingGeneration || this.#session.thread.getId() !== state.threadId || this.#session.identity.getResourceId() !== state.resourceId) break;
1042: 					if (savedUsage) this.#session.setTokenUsage({
1043: 						...createEmptyTokenUsage(),
1044: 						...savedUsage
1045: 					});
1046: 					else this.#session.addUsage(stepUsage);
1047: 					this.#session.emit({
1048: 						type: "usage_update",
1049: 						usage: stepUsage
1050: 					});
1051: 				}
1052: 				break;
1053: 			}
1054: 			case "finish": {
```

## @mastra/core@1.78.0 / dist/stream/types.d.ts

SHA-256: `26b218ba23a8f2eb157990811a71dcb37867b7a374d809b40a8e11c3d6702f02`

```text
1153: /**
1154:  * Extended usage type that includes raw provider data.
1155:  * Extends LanguageModelV2Usage with additional fields for V3 compatibility.
1156:  */
1157: export type LanguageModelUsage = LanguageModelV2Usage & {
1158:     reasoningTokens?: number;
1159:     cachedInputTokens?: number;
1160:     cacheCreationInputTokens?: number;
1161:     cacheCreationInputTokens5m?: number;
1162:     cacheCreationInputTokens1h?: number;
1163:     /**
1164:      * Raw usage data from the provider, preserved for advanced use cases.
1165:      * For V3 models, contains the full nested structure:
1166:      * { inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }
1167:      */
1168:     raw?: unknown;
1169: };
1170: export type partialModel = {
1171:     modelId?: string;
```

## @mastra/core@1.78.0 / dist/stream-Ty0oC3da.js

SHA-256: `b15c48ec7f987399c533f02ddfe9bb877e171388a008920d972db5c46340eb46`

```text
1164: function normalizeUsage(usage, providerMetadata) {
1165: 	const cacheCreationUsage = getAnthropicCacheCreationUsage(usage, providerMetadata);
1166: 	if (!usage) return {
1167: 		inputTokens: void 0,
1168: 		outputTokens: void 0,
1169: 		totalTokens: void 0,
1170: 		reasoningTokens: void 0,
1171: 		cachedInputTokens: void 0,
1172: 		cacheCreationInputTokens: void 0,
1173: 		...cacheCreationUsage,
1174: 		raw: void 0
1175: 	};
1176: 	if (isV3Usage(usage)) {
1177: 		const input = innermostTokens(usage.inputTokens);
1178: 		const output = innermostTokens(usage.outputTokens);
1179: 		const inputTokens = input.total;
1180: 		const outputTokens = output.total;
1181: 		return {
1182: 			inputTokens,
1183: 			outputTokens,
1184: 			totalTokens: inputTokens !== void 0 && outputTokens !== void 0 ? inputTokens + outputTokens : void 0,
1185: 			reasoningTokens: output.reasoning,
1186: 			cachedInputTokens: input.cacheRead,
1187: 			cacheCreationInputTokens: input.cacheWrite,
1188: 			...cacheCreationUsage,
1189: 			raw: usage
1190: 		};
1191: 	}
1192: 	const v2Usage = usage;
1193: 	return {
1194: 		inputTokens: v2Usage.inputTokens,
1195: 		outputTokens: v2Usage.outputTokens,
1196: 		totalTokens: v2Usage.totalTokens ?? (v2Usage.inputTokens !== void 0 && v2Usage.outputTokens !== void 0 ? v2Usage.inputTokens + v2Usage.outputTokens : void 0),
1197: 		reasoningTokens: v2Usage.reasoningTokens,
1198: 		cachedInputTokens: v2Usage.cachedInputTokens,
1199: 		cacheCreationInputTokens: v2Usage.cacheCreationInputTokens,
1200: 		...cacheCreationUsage,
1201: 		raw: usage
1202: 	};
1203: }
1204: /**
1205: * Type guard to check if a finish reason is V3 format (object with unified/raw properties)
```

## @mastra/core@1.78.0 / dist/docs/references/reference-agents-generate.md

SHA-256: `adc25a03b2487eff788a59a950a2129adc91d2a1fb3842ccad1a8733530ed6eb`

```text
307: **toolResults.payload.toolName** (`string`): Name of the tool that produced the result.
308: 
309: **toolResults.payload.result** (`unknown`): Value returned by the tool.
310: 
311: **toolResults.payload.isError** (`boolean`): Whether the tool execution failed.
312: 
313: **usage** (`TokenUsage`): Token usage statistics for the generation.
314: 
315: **steps** (`object[]`): Array of execution steps, useful for debugging multi-step generations.
316: 
317: **steps.text** (`string`): Text generated in this step.
318: 
319: **steps.toolCalls** (`ToolCallChunk[]`): Tool calls emitted during this step.
320: 
321: **steps.toolResults** (`ToolResultChunk[]`): Tool results emitted during this step.
322: 
323: **steps.finishReason** (`string`): Why this step finished.
324: 
325: **steps.usage** (`LanguageModelUsage`): Token usage for this step.
326: 
327: **steps.request** (`{ body?: unknown }`): Request metadata for this step.
328: 
```

## @ai-sdk/openai@3.0.131 / dist/index.js

SHA-256: `600b998cd01cb15c0a1516e846d98440f708fd223158bb0c57172addcec0ff79`

```text
3038: // src/responses/convert-openai-responses-usage.ts
3039: function convertOpenAIResponsesUsage(usage) {
3040:   var _a2, _b, _c, _d, _e, _f;
3041:   if (usage == null) {
3042:     return {
3043:       inputTokens: {
3044:         total: void 0,
3045:         noCache: void 0,
3046:         cacheRead: void 0,
3047:         cacheWrite: void 0
3048:       },
3049:       outputTokens: {
3050:         total: void 0,
3051:         text: void 0,
3052:         reasoning: void 0
3053:       },
3054:       raw: void 0
3055:     };
3056:   }
3057:   const inputTokens = usage.input_tokens;
3058:   const outputTokens = usage.output_tokens;
3059:   const cachedTokens = (_b = (_a2 = usage.input_tokens_details) == null ? void 0 : _a2.cached_tokens) != null ? _b : 0;
3060:   const cacheWriteTokens = (_d = (_c = usage.input_tokens_details) == null ? void 0 : _c.cache_write_tokens) != null ? _d : void 0;
3061:   const reasoningTokens = (_f = (_e = usage.output_tokens_details) == null ? void 0 : _e.reasoning_tokens) != null ? _f : 0;
3062:   return {
3063:     inputTokens: {
3064:       total: inputTokens,
3065:       noCache: inputTokens - cachedTokens - (cacheWriteTokens != null ? cacheWriteTokens : 0),
3066:       cacheRead: cachedTokens,
3067:       cacheWrite: cacheWriteTokens
3068:     },
3069:     outputTokens: {
3070:       total: outputTokens,
3071:       text: outputTokens - reasoningTokens,
3072:       reasoning: reasoningTokens
3073:     },
3074:     raw: usage
3075:   };
3076: }
3077: 
3078: // src/responses/convert-to-openai-responses-input.ts
```

## @ai-sdk/openai-compatible@2.0.87 / dist/index.js

SHA-256: `0d32ec93849675fbc0bebc69101a1bd2d4fadd5056a6af5093a306015e23f220`

```text
67: // src/chat/convert-openai-compatible-chat-usage.ts
68: function convertOpenAICompatibleChatUsage(usage) {
69:   var _a, _b, _c, _d, _e, _f;
70:   if (usage == null) {
71:     return {
72:       inputTokens: {
73:         total: void 0,
74:         noCache: void 0,
75:         cacheRead: void 0,
76:         cacheWrite: void 0
77:       },
78:       outputTokens: {
79:         total: void 0,
80:         text: void 0,
81:         reasoning: void 0
82:       },
83:       raw: void 0
84:     };
85:   }
86:   const promptTokens = (_a = usage.prompt_tokens) != null ? _a : 0;
87:   const completionTokens = (_b = usage.completion_tokens) != null ? _b : 0;
88:   const cacheReadTokens = (_d = (_c = usage.prompt_tokens_details) == null ? void 0 : _c.cached_tokens) != null ? _d : 0;
89:   const reasoningTokens = (_f = (_e = usage.completion_tokens_details) == null ? void 0 : _e.reasoning_tokens) != null ? _f : 0;
90:   return {
91:     inputTokens: {
92:       total: promptTokens,
93:       noCache: promptTokens - cacheReadTokens,
94:       cacheRead: cacheReadTokens,
95:       cacheWrite: void 0
96:     },
97:     outputTokens: {
98:       total: completionTokens,
99:       text: Math.max(0, completionTokens - reasoningTokens),
100:       reasoning: reasoningTokens
101:     },
102:     raw: usage
103:   };
104: }
```

```text
650:   }
651:   async doStream(options) {
652:     var _a;
653:     const { args, warnings, metadataKey } = await this.getArgs({ ...options });
654:     const body = this.transformRequestBody({
655:       ...args,
656:       stream: true,
657:       // only include stream_options when in strict compatibility mode:
658:       stream_options: this.config.includeUsage ? { include_usage: true } : void 0
659:     });
660:     const metadataExtractor = (_a = this.config.metadataExtractor) == null ? void 0 : _a.createStreamExtractor();
```

```text
764:             const value = chunk.value;
765:             if (isFirstChunk) {
766:               isFirstChunk = false;
767:               controller.enqueue({
768:                 type: "response-metadata",
769:                 ...getResponseMetadata(value)
770:               });
771:             }
772:             if (value.usage != null) {
773:               usage = value.usage;
774:             }
775:             const choice = value.choices[0];
776:             if ((choice == null ? void 0 : choice.finish_reason) != null) {
777:               finishReason = {
778:                 unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
```

```text
883:               providerMetadata[providerOptionsName].rejectedPredictionTokens = (_d = usage == null ? void 0 : usage.completion_tokens_details) == null ? void 0 : _d.rejected_prediction_tokens;
884:             }
885:             controller.enqueue({
886:               type: "finish",
887:               finishReason,
888:               usage: convertUsage(usage),
889:               providerMetadata
890:             });
891:           }
892:         })
893:       ),
894:       request: { body },
```

```text
1798:       if (options.queryParams) {
1799:         url.search = new URLSearchParams(options.queryParams).toString();
1800:       }
1801:       return url.toString();
1802:     },
1803:     headers: getHeaders,
1804:     fetch: options.fetch
1805:   });
1806:   const createLanguageModel = (modelId) => createChatModel(modelId);
1807:   const createChatModel = (modelId) => new OpenAICompatibleChatLanguageModel(modelId, {
1808:     ...getCommonModelConfig("chat"),
1809:     includeUsage: options.includeUsage,
1810:     supportsStructuredOutputs: options.supportsStructuredOutputs,
1811:     supportedUrls: options.supportedUrls,
1812:     transformRequestBody: options.transformRequestBody,
1813:     metadataExtractor: options.metadataExtractor,
1814:     convertUsage: options.convertUsage
1815:   });
1816:   const createCompletionModel = (modelId) => new OpenAICompatibleCompletionLanguageModel(modelId, {
1817:     ...getCommonModelConfig("completion"),
1818:     includeUsage: options.includeUsage
1819:   });
```

## @ai-sdk/openai-compatible@2.0.87 / docs/index.mdx

SHA-256: `c1cac04209455a42af77f0722a5933794f90758f39372232af4741da85ded3af`

```text
48: import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
49: 
50: const provider = createOpenAICompatible({
51:   name: 'providerName',
52:   apiKey: process.env.PROVIDER_API_KEY,
53:   baseURL: 'https://api.provider.com/v1',
54:   includeUsage: true, // Include usage information in streaming responses
55: });
56: ```
57: 
58: You can use the following optional settings to customize the provider instance:
59: 
60: - **baseURL** _string_
61: 
62:   Set the URL prefix for API calls.
63: 
```

## @ai-sdk/provider@2.0.5 / dist/index.d.ts

SHA-256: `ef74b3141b39f4dea22f719068baee710c566b9fdbbb17c33a18c7d41df1af48`

```text
1110: /**
1111: Usage information for a language model call.
1112: 
1113: If your API return additional usage information, you can add it to the
1114: provider metadata under your provider's key.
1115:  */
1116: type LanguageModelV2Usage = {
1117:     /**
1118:   The number of input (prompt) tokens used.
1119:      */
1120:     inputTokens: number | undefined;
1121:     /**
1122:   The number of output (completion) tokens used.
1123:      */
1124:     outputTokens: number | undefined;
1125:     /**
1126:   The total number of tokens as reported by the provider.
1127:   This number might be different from the sum of `inputTokens` and `outputTokens`
1128:   and e.g. include reasoning tokens or other overhead.
1129:      */
1130:     totalTokens: number | undefined;
1131:     /**
1132:   The number of reasoning tokens used.
1133:      */
1134:     reasoningTokens?: number | undefined;
1135:     /**
1136:   The number of cached input tokens.
1137:      */
1138:     cachedInputTokens?: number | undefined;
1139: };
1140: 
```
