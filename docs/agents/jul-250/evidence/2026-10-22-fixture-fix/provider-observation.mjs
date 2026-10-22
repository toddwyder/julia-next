// All current learning/Proof inference shares the card tracker and role admission.
import {createRequestTracker} from '../../../../../scripts/commandcode-requests.mjs'
delete process.env.OP_SERVICE_ACCOUNT_TOKEN
const original=globalThis.fetch
const tracker=await createRequestTracker({path:process.env.JULIA_CARD_COST_PATH??'/tmp/jul250-cost/card.json'})
globalThis.fetch=(input,init)=>{
 const url=String(input instanceof Request?input.url:input)
 if(!/chat\/completions|\/responses|\/messages/.test(url))return original(input,init)
 return tracker.fetch(input,init,'proof','machinery')
}
