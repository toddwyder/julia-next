"""Exercise the real wait SQL against isolated PostgreSQL fixture tables.

Run as a role that can create temporary tables, for example:
  sudo -u postgres python3 ops/factory/wait-alerts.sql.test.py julia_factory_trial
The test shadows Factory tables in this one psql session and writes no Factory rows.
"""

import json
from pathlib import Path
import subprocess
import sys


FIXTURES = r"""
CREATE TEMP TABLE factory_run_bindings (
  session_id text, thread_id text, work_item_id text,
  factory_project_id text, status text
);
CREATE TEMP TABLE work_items (
  id uuid, title text, board text, stages jsonb, accepted_at timestamptz,
  metadata jsonb, factory_project_id text, updated_at timestamptz
);
CREATE TEMP TABLE mastra_messages (
  thread_id text, content text, "createdAtZ" timestamptz
);
CREATE TEMP TABLE factory_attention_receipts (
  user_id text, factory_project_id text, kind text, source_id text,
  state text, created_at timestamptz, occurrence bigint
);
CREATE TEMP TABLE factory_supervisor_findings (
  factory_project_id text, finding_key text, occurrence integer,
  finding jsonb, opened_at timestamptz, resolved_at timestamptz
);
INSERT INTO work_items
  (id,title,board,stages,accepted_at,metadata,factory_project_id,updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001','Pending question','work','["execute"]',now(),'{}','test-project',now()),
  ('00000000-0000-0000-0000-000000000002','Pending plan','work','["plan"]',now(),'{}','test-project',now()),
  ('00000000-0000-0000-0000-000000000003','Answered question','work','["execute"]',now(),'{}','test-project',now()),
  ('00000000-0000-0000-0000-000000000004','Archived plan','work','["plan"]',now(),'{}','test-project',now()),
  ('00000000-0000-0000-0000-000000000005','Unrelated suggestion','work','["intake"]',NULL,'{}','test-project',now());
INSERT INTO factory_run_bindings VALUES
  ('s-question','t-question','00000000-0000-0000-0000-000000000001','test-project','active'),
  ('s-plan','t-plan','00000000-0000-0000-0000-000000000002','test-project','active'),
  ('s-complete','t-complete','00000000-0000-0000-0000-000000000003','test-project','active'),
  ('s-archived','t-archived','00000000-0000-0000-0000-000000000004','test-project','active'),
  ('s-other','t-other','00000000-0000-0000-0000-000000000005','test-project','active');
INSERT INTO mastra_messages VALUES
  ('t-question',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','ask_user','toolCallId','ask-new','state','call'))))::text,'2026-09-29 03:00:00+00'),
  ('t-plan',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','submit_plan','toolCallId','plan-new','state','call'))))::text,'2026-09-29 03:00:00+00'),
  ('t-complete',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','ask_user','toolCallId','ask-done','state','call'))))::text,'2026-09-29 03:00:00+00'),
  ('t-complete',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','ask_user','toolCallId','ask-done','state','result'))))::text,'2026-09-29 03:01:00+00'),
  ('t-archived',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','submit_plan','toolCallId','plan-archived','state','call'))))::text,'2026-09-29 03:00:00+00'),
  ('t-other',jsonb_build_object('parts',jsonb_build_array(jsonb_build_object(
    'type','tool-invocation','toolInvocation',jsonb_build_object(
      'toolName','request_access','toolCallId','not-a-wait','state','call'))))::text,'2026-09-29 03:00:00+00');
INSERT INTO factory_attention_receipts VALUES
  ('test-user','test-project','agent-waiting','s-archived','archived','2026-09-29 03:02:00+00',0);
"""


def main():
    database = sys.argv[1] if len(sys.argv) > 1 else 'julia_factory_trial'
    sql = Path(__file__).with_name('wait-alerts.sql').read_text(encoding='utf-8')
    result = subprocess.run(
        ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
         '-v', 'project_id=test-project', '-v', 'user_id=test-user', '-d', database],
        input=FIXTURES + '\n' + sql, capture_output=True, text=True, check=True,
        timeout=30,
    )
    rows = [json.loads(line) for line in result.stdout.splitlines() if line]
    by_key = {row['key']: row for row in rows}
    expected = {'agent-waiting:s-question:ask-new', 'agent-waiting:s-plan:plan-new'}
    assert set(by_key) == expected, f'unexpected wait keys: {sorted(by_key)}'
    assert by_key['agent-waiting:s-question:ask-new']['detail'] == 'The agent is waiting for your answer'
    assert by_key['agent-waiting:s-plan:plan-new']['detail'] == 'A plan is waiting for your review'
    assert by_key['agent-waiting:s-question:ask-new']['path'].endswith('/workspaces/s-question/threads/t-question')
    print('PASS: new question and plan appear; completed, archived and unrelated calls do not')


if __name__ == '__main__':
    main()
