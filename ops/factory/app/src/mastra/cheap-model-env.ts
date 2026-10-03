/**
 * Points Factory's observational memory at the cheap-model setting.
 *
 * `@mastra/code-sdk` reads `DEFAULT_OM_MODEL_ID` from the environment once, when
 * its constants module first loads. The entry point imports this module before
 * any SDK module so that read sees `JULIA_CHEAP_MODEL`, and it checks the
 * result after the SDK has loaded. A separate `DEFAULT_OM_MODEL_ID` in the
 * server environment is overwritten, so one setting controls the job.
 */
import { cheapModel } from './reviewer/model-choice';

/** Throws, naming only the setting, when observational memory is not using the cheap setting. */
export function assertObservationalMemoryUsesCheapModel(
  configuredObservationalMemoryModel: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (configuredObservationalMemoryModel !== cheapModel(env)) {
    throw new Error('Factory observational memory is not using JULIA_CHEAP_MODEL; DEFAULT_OM_MODEL_ID was read before it was applied.');
  }
}

process.env.DEFAULT_OM_MODEL_ID = cheapModel(process.env);
