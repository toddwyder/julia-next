"""Exercise the face-value query against version-2 issue-cost record shapes.

Run on the Factory host with a PostgreSQL URL available to psql. The tables are
temporary, so fixture rows never reach Factory's persistent accounting tables.
"""

import json
from pathlib import Path
import subprocess
import sys


FIXTURES = r"""
CREATE TEMP TABLE factory_issue_cost_records (
  issue_number bigint, record jsonb, saved_at timestamptz
);
CREATE TEMP TABLE factory_model_prices (
  provider text, model text, token_type text, usd_per_token numeric,
  effective_from timestamptz
);
INSERT INTO factory_issue_cost_records VALUES
  (211, '{"version":2,"tokens":[{"provider":"openai","model":"gpt-later","effort":"high","effortSources":["span"],"freshInputTokens":10,"cacheReadTokens":2,"cacheWriteTokens":1,"outputTokens":4,"thinkingTokens":3}]}', '2026-10-07 10:00:00+00'),
  (212, '{"version":2,"tokens":[{"provider":"openai","model":"gpt-in-force","effort":"low","effortSources":["session"],"freshInputTokens":10,"cacheReadTokens":2,"cacheWriteTokens":1,"outputTokens":4,"thinkingTokens":3}]}', '2026-10-07 12:00:00+00'),
  (213, '{"version":2,"tokens":[{"provider":"openai","model":"gpt-in-force","effort":"medium","effortSources":["span"],"freshInputTokens":10,"cacheReadTokens":2,"cacheWriteTokens":"unknown","outputTokens":4,"thinkingTokens":3}]}', '2026-10-07 12:00:00+00');
INSERT INTO factory_model_prices
SELECT 'openai', model, token_type, rate, effective_from
FROM (VALUES
  ('gpt-in-force', 'freshInputTokens', 0.1::numeric, '2026-10-07 09:00:00+00'::timestamptz),
  ('gpt-in-force', 'cacheReadTokens', 0.2::numeric, '2026-10-07 09:00:00+00'::timestamptz),
  ('gpt-in-force', 'cacheWriteTokens', 0.3::numeric, '2026-10-07 09:00:00+00'::timestamptz),
  ('gpt-in-force', 'outputTokens', 0.4::numeric, '2026-10-07 09:00:00+00'::timestamptz),
  ('gpt-in-force', 'thinkingTokens', 0.5::numeric, '2026-10-07 09:00:00+00'::timestamptz),
  ('gpt-in-force', 'freshInputTokens', 0.6::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-in-force', 'cacheReadTokens', 0.7::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-in-force', 'cacheWriteTokens', 0.8::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-in-force', 'outputTokens', 0.9::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-in-force', 'thinkingTokens', 1.0::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'freshInputTokens', 0.6::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'cacheReadTokens', 0.7::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'cacheWriteTokens', 0.8::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'outputTokens', 0.9::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'thinkingTokens', 1.0::numeric, '2026-10-07 11:00:00+00'::timestamptz),
  ('gpt-later', 'freshInputTokens', 1.1::numeric, '2026-10-07 13:00:00+00'::timestamptz),
  ('gpt-later', 'cacheReadTokens', 1.2::numeric, '2026-10-07 13:00:00+00'::timestamptz),
  ('gpt-later', 'cacheWriteTokens', 1.3::numeric, '2026-10-07 13:00:00+00'::timestamptz),
  ('gpt-later', 'outputTokens', 1.4::numeric, '2026-10-07 13:00:00+00'::timestamptz),
  ('gpt-later', 'thinkingTokens', 1.5::numeric, '2026-10-07 13:00:00+00'::timestamptz)
) AS prices(model, token_type, rate, effective_from);
"""


def main():
    database_url = sys.argv[1]
    sql = Path(__file__).with_name('model-face-values.sql').read_text(encoding='utf-8')
    result = subprocess.run(
        ['psql', database_url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
        input=FIXTURES + '\n' + sql,
        capture_output=True, text=True, check=True, timeout=30,
    )
    rows = [line.split('|') for line in result.stdout.splitlines() if line]
    by_issue = {int(row[0]): row for row in rows}
    assert by_issue[211][-1] == 'earliest known price', by_issue[211]
    assert by_issue[211][-3] == '14.8', by_issue[211]
    assert by_issue[212][-1] == 'in force', by_issue[212]
    assert by_issue[212][-3] == '14.8', by_issue[212]
    assert by_issue[213][-2] == 'price unknown', by_issue[213]
    assert by_issue[213][-1] == '', by_issue[213]
    assert json.loads(by_issue[211][5])['freshInputTokens'] == '10'
    print('PASS: uses in-force prices first and otherwise the earliest later price')


if __name__ == '__main__':
    main()
