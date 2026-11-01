// The stop that ends a remediation loop belongs to the session the investigation
// ran in, and that session keeps its own store inside the run folder. The stop
// hook looks threads up in the shared store, so it cannot see that session: it
// fell back to the newest thread in the shared store and read the card off a
// branch name, which filed a practice stop against JUL-307.
//
// The runner knows the thread it started and the card the loop worked on, so it
// says both and the hook reads neither from the store nor from the branch.
export function stopPingDeps({ thread, card, projectPath = null }) {
  return {
    threadFor: () => ({ thread, threadSource: 'runner' }),
    threadCardFor: () => card,
    projectPathFor: () => projectPath,
  };
}
