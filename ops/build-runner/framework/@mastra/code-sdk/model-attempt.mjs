// Julia-owned classification only: a missing model step is never a guard verdict.
export async function modelAttempt(t,body){
 for(let attempt=1;attempt<=2;attempt++){
  if(await body(attempt))return
  console.log(JSON.stringify({fact:'model did not attempt',outcome:'inconclusive',attempt,test:t.name,guardVerdict:null}))
 }
 t.skip('inconclusive: model did not attempt after one rerun; no guard verdict')
}
