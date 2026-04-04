## Token generator (YouTube Analytics OAuth)

Used to create **refresh token JSON** objects for Railway **`YT_ANALYTICS_TOKENS_JSON`**.

---

### You (owner): refresh 5 accounts, keep CrazyMomente as-is

CrazyMomente uses a **different** OAuth client than your main five channels. **Do not** re-run the generator for that account if the token still works—just **reuse** the existing JSON object.

1. **Save the working CrazyMomente token** (one object) as e.g. `out/crazymomente.json`  
   Copy it from Railway or from `analytics-token-friend.json` — same `client_id` / `client_secret` / `refresh_token` as today.

2. Put your **main** OAuth client secret in this folder as **`client_secret.json`**  
   (the file whose `client_id` matches your five brand tokens, e.g. `675244993101-...`).

3. Install deps:

```bash
cd token-generator
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

4. **Run the browser login once per Google account** that owns **Asenti, Aven, Mira, Nunito**, and your fifth main login if you have five (same client for all five):

```bash
mkdir -p out
export YT_ANALYTICS_TOKEN_OUT="out/asenti.json"
python generate_token.py
# log in as the Asenti channel owner, approve consent

export YT_ANALYTICS_TOKEN_OUT="out/aven.json"
python generate_token.py

export YT_ANALYTICS_TOKEN_OUT="out/mira.json"
python generate_token.py

export YT_ANALYTICS_TOKEN_OUT="out/nunito.json"
python generate_token.py

# If you have a 5th account on the SAME client_secret:
# export YT_ANALYTICS_TOKEN_OUT="out/other.json"
# python generate_token.py
```

5. **Merge** the five new files **plus** the CrazyMomente file you saved (6 objects total if you have 5+friend):

```bash
python merge_tokens_for_railway.py \
  out/asenti.json out/aven.json out/mira.json out/nunito.json \
  out/crazymomente.json
```

Adjust the list if you have fewer/more files — order does not matter for the scraper.

6. Open **`railway-yt-analytics-tokens.compact.txt`** (or the pretty `.json`), copy **all**, paste into Railway → **`YT_ALYTICS_TOKENS_JSON`**, save, redeploy / run cron.

---

### Friend (single channel, optional)

They only need:

1. The **OAuth client secret JSON** you give them (or their own client file).
2. Python.

Put their `client_secret.json` in this folder, then:

```bash
python generate_token.py
```

Default output: **`analytics-token-friend.json`**. They send you that file; you merge it with yours using `merge_tokens_for_railway.py` if needed.

---

### Files (secrets — never commit)

| File | Purpose |
|------|--------|
| `client_secret.json` | OAuth client from Google Cloud (you add locally) |
| `out/*.json` | One refresh token per login |
| `railway-yt-analytics-tokens.json` | Merged array (pretty) |
| `railway-yt-analytics-tokens.compact.txt` | One line for Railway |

Treat every token file like a password.
