# API Balance Widget (Marinara extension)

*[한국어 안내는 여기](./README.md)*

A single **💰 button** on your Marinara screen that shows your **DeepSeek
balance** and **OpenRouter credits**. Drag the button anywhere; balances are
cached for one minute.

Claude (Anthropic) usage cannot be shown from an extension (see below), so
the bundled CLI script `balance.mjs` covers that instead.

## Version compatibility

| Marinara version | Release to use |
|---|---|
| **2.5.2 (QA verified 2026-11-06)** | **v2.0.1** — current source / this README |
| 2.3.3 and earlier | v1.0.0 (legacy, marked pre-release) |
| 2.3.4 | no extension system — cannot be used |

## ⚠️ API key handling — read before installing

Being upfront:

- Keys are sent **only to each provider (DeepSeek / OpenRouter)** to fetch
  balances. Nowhere else.
- Keys are stored **in plaintext in your Marinara server's DB** (Marinara's
  extension storage does not encrypt). This means **keys can be included in
  a profile export ZIP** — be careful when sharing an exported file.
- Consider using a dedicated read-only/limited key (OpenRouter supports
  per-key limits).

## Install (Marinara 2.5.2, four safety gates)

1. **`.env` gate**: add `ENABLE_EXTERNAL_EXTENSIONS=true` to the `.env` in
   your install folder, then restart.
> **🐳 Using Docker?** — edit `docker-compose.yml` instead of `.env`.
> Find the `environment:` line and add **one line** under it (match the
> indentation of its neighbors):
>
> ```yaml
>       - ENABLE_EXTERNAL_EXTENSIONS=true
> ```
>
> Save, then run `docker compose up -d`.
> If you access Marinara from another device's browser, also add
> `- ADMIN_SECRET=yoursecret` in the same place (needed to open the Danger Zone).
> To confirm it took effect:
>
> ```sh
> docker compose exec marinara env | grep ENABLE_EXTERNAL
> ```
>
> If the value prints, it's applied; if not, run `docker compose up -d` once more.

2. **In-app gate**: **Settings → Advanced → Danger Zone → Allow third-party
   extension imports**.
3. **Import**: download `marinara-balance-widget.zip` from the
   [**Releases page**](../../releases/latest), then import it **as-is** in
   **Settings → Addons → External Extensions** using **Import Extension File**.
   For a folder install, use **Import Extension Folder** and select the
   `extension` folder containing `manifest.json` and `extension.js`.
4. **Approve**: power icon → the **full page access** dialog → **"Run this
   exact code"**. *(The dialog reappears whenever the file changes — by design.)*

## Install from GitHub

Marinara 2.5.2's **External Extensions** only offers **Import Extension File**
and **Import Extension Folder**; it has no GitHub install field. To install
from GitHub, enable extension imports as described above, then install and
enable a GitHub-installer extension such as
[ME.Fetchy](https://github.com/FigCake/ME.Fetchy). Enter this exact path in
that extension's GitHub install field:

```text
mallang0723/ME-BalanceWidget/extension
```

Approve **full page access** and enable the extension. This is the existing
permission needed to add the button and panel to the page; no access is added.

Manual ZIP import remains available. To package the current source, run this
from the repository root and import the resulting ZIP using the steps above.
Both files will be at the ZIP root:

```bash
(cd extension && zip ../marinara-balance-widget.zip manifest.json extension.js)
```

See the [changelog (Korean)](./CHANGELOG.md) for changes.

## Usage

1. Click the 💰 button → the panel opens
2. ⚙ Settings → enter your DeepSeek / OpenRouter API key → Save
   - Saved keys are not shown back in the field; a "saved" hint appears instead
   - **Saving with a field left blank keeps the existing key**; only what you
     type is replaced
3. Balances appear. ↻ refresh bypasses the 1-minute cache and fetches now

| Shown | Meaning |
|---|---|
| Key error (expired / permission) | Wrong or expired key (HTTP 401/403) |
| Rate limited — retry in N s | Provider throttling (HTTP 429) |
| No key set | Add a key in ⚙ Settings |

## Why is there no Claude usage?

Anthropic's balance/usage API **deliberately blocks browser access** (it's an
admin endpoint — verified). Extensions run in the browser, so there is no way
to fetch it, and working around that would be wrong (the point is not to put
an admin key in a browser).

Instead, run the bundled **`balance.mjs`** in a terminal to see all three
(DeepSeek / OpenRouter / Claude month-to-date) at once:

```bash
node balance.mjs
```

Keys are read from environment variables only (`DEEPSEEK_API_KEY`,
`OPENROUTER_API_KEY`, `ANTHROPIC_ADMIN_KEY` — Claude needs an **admin key**
(`sk-ant-admin…`); a regular API key will not work). Nothing is stored.

## License

MIT
