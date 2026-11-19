// Julia keeps error reports free of personal and request data. Sentry v10 reads
// `sendDefaultPii: false`; v11 reads `dataCollection` and collects everything when it is unset.
// Both sets of options are passed so the behaviour is the same on either version.
const DENY_LIST = ['forwarded', '-ip', 'remote-', 'via', '-user'];

export const SENTRY_PRIVACY_OPTIONS = Object.freeze({
  sendDefaultPii: false,
  dataCollection: Object.freeze({
    userInfo: false,
    cookies: false,
    httpHeaders: Object.freeze({ request: Object.freeze({ deny: DENY_LIST }), response: Object.freeze({ deny: DENY_LIST }) }),
    httpBodies: Object.freeze([]),
    urlQueryParams: Object.freeze({ deny: DENY_LIST }),
    genAI: Object.freeze({ inputs: false, outputs: false }),
    databaseQueryData: false,
    graphQL: Object.freeze({ document: false, variables: false }),
  }),
});
