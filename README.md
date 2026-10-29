# CLEC公開分布資料：尚未啟用的部署候選

只有集保公開分布、公開分割事件及更新程式；不包含APP完整原始碼、私人持股、UID、機構、Key或登入憑證。網站仍由原Firebase提供。本包尚未建立公開儲存庫、部署或啟用排程。

- Node.js 24；`npm run verify`驗證已整理檔案，不查官方。
- `npm run update`會以1100ms單線核對五檔最近4期；20秒逾時、30秒冷卻與一次重試，遵守Retry-After，拒絕／格式異常停止。只讀官方公開表單，不抓私人Fugle資料。
- `.state/checkpoint.json`一次原子保存公開資料、進度與來源冷卻；一般失敗由Actions收尾提交保存。Runner被強制銷毀而未提交的進度可能需要重查，不能保證所有硬中斷都已跨Runner保存。
- 更新全數驗證後才改assets；失敗保留原公開檔案。內容相同不改既有版本檔或重新發布。資料與版本清單一起部署，保留最近兩批版本。
- `_headers`只允許既有網站跨來源瀏覽器讀取；這是公開資料，不是存取授權。manifest短快取，版本檔長快取，不設動態Worker優先、不使用D1。
- 準備的週更為週六／一台灣10:00；雲端排程可能延遲或停用，不承諾準點及永不中斷。使用GitHub原生失敗通知及手動重跑。
- 啟用前設定Cloudflare免費帳戶、靜態專案名稱及GitHub Secrets：CLOUDFLARE_API_TOKEN／CLOUDFLARE_ACCOUNT_ID；變數PUBLIC_DATA_URL。憑證不得進檔案；僅授權管理者設定，不要求一般使用者設定。
- 先做一次雲端有界官方來源測試，遇429／拒絕立即停止，不用代理繞過。設定零付費預算，不綁卡、不升級。
- 工作流程只在main定時或手動執行，不以外部PR執行含部署憑證的工作。普通失敗後仍保存進度；發布未確認成功不更新published版本，下次可重試發布。

來源：臺灣集中保管結算所「集保戶股權分散表」。開放資料及使用聲明：https://data.gov.tw/dataset/11452 、https://data.gov.tw/license 。歷史查詢：https://www.tdcc.com.tw/portal/zh/smWeb/qryStock 。保留實際資料日期與原始級距，缺期不補造，分割預告不提前套用。
