# Rehearsal: card-runner step 1 (throwaway)

Free Shipping passes: `shipping-verdict` job. Final pass: `checks` job.

A finished build opens a pull request whose head commit names the card. The shipping-verdict job then requires an independent PASS verdict on that head before CI goes green. Shipping runs the final pass and lands the change only after Todd's UAT yes.
