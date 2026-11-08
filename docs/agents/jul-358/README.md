# JUL-358 records

The Start screen shows a saved pick for every machine stage. `start-screen.png` is the full page. `start-screen-rows.json` holds every picker row and its model id.

| Stage | Saved pick | Practice run |
| --- | --- | --- |
| Shipping | `commandcode/moonshotai/Kimi-K3.1-Pro` | The Shipping review runs on this pick; this card's review is that run. |
| Remediation | `commandcode/deepseek/deepseek-v4.1-flash` | `practice-remediation.json` requested and answered this model. The practice file read `OK`. |
| Retro | `openai/gpt-6.1-sol` | `practice-retro.json` requested and answered this model. The retro doc was written. |

The two practice runs used small practice cards, JUL-998 and JUL-999. Their logs are beside the records.
