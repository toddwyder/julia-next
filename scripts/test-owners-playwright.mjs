import { annotateFailure } from './test-owners.mjs';

export default class AnnotationReporter {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd() {
    for (const test of this.suite.allTests()) {
      if (test.ok()) continue;
      const result = test.results.at(-1);
      const error = result.errors[0];
      annotateFailure({
        file: test.location.file,
        name: test.titlePath().slice(3).join(' > '),
        message: error?.message ?? error?.value ?? result.status,
      }, process.env.TEST_OWNERS_ROOT);
    }
  }
}
