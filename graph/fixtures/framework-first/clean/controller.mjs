// Clean example using ordinary LangGraph code: checkpointer, interrupt(), retryPolicy
import { StateGraph, Annotation, interrupt } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';

const ControllerState = Annotation.Root({
  messages: Annotation({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),
});

const checkpointer = new MemorySaver();

const retryPolicy = {
  maxAttempts: 3,
  initialInterval: 1000,
  backoffFactor: 2,
};

async function humanApprovalNode(state) {
  const approval = interrupt({
    prompt: 'Approve execution?',
    currentState: state,
  });
  return {
    messages: [{ role: 'assistant', content: `Approved: ${approval}` }],
  };
}

const workflow = new StateGraph(ControllerState)
  .addNode('approval', humanApprovalNode, { retryPolicy })
  .addEdge('__start__', 'approval')
  .addEdge('approval', '__end__');

export const controller = workflow.compile({ checkpointer });
