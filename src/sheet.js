import { google } from "googleapis";

/* =====================================================
   ID DA PLANILHA
===================================================== */
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "18tagiBqebJEUEv61dxsnAcKcfk3tQ--jzJLpyAGt92E";

/* =====================================================
   AUTH (PRODUÇÃO): via variável GOOGLE_SERVICE_ACCOUNT_JSON
   - No Railway/Render/etc você vai criar essa variável
   - Localmente, você pode setar ela usando seu credentials.json
===================================================== */
function getServiceAccountFromEnv() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "Faltando GOOGLE_SERVICE_ACCOUNT_JSON no ambiente. " +
      "Em produção, crie a variável com o conteúdo do credentials.json. " +
      "Local: export/defina GOOGLE_SERVICE_ACCOUNT_JSON antes do npm start."
    );
  }

  // Algumas plataformas pedem o JSON em 1 linha; outras aceitam multiline.
  // Aqui garantimos que o private_key com '\n' funcione.
  const obj = JSON.parse(raw);

  if (obj.private_key && typeof obj.private_key === "string") {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }

  return obj;
}

/* =====================================================
   CLIENTE SHEETS — LAZY e memoizado
   - Antes a auth rodava no top-level do módulo: importar db.js/sheet.js sem a
     env explodia no load (tornava a camada de dados intestável e derrubava a
     função serverless inteira no cold start). Agora só autentica na 1ª chamada.
===================================================== */
let _sheetsClient = null;
function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const serviceAccount = getServiceAccountFromEnv();
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

/* =====================================================
   🔵 LER PLANILHA
   - PROPAGA o erro (throw) em vez de mascarar como []: quem chama diferencia
     "planilha vazia" de "Sheets indisponível" e mostra banner em vez de "0".
   - Uma faixa realmente vazia devolve [] (via `|| []`), isso NÃO é erro.
===================================================== */
export async function getSheetData(range) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return res.data.values || [];
}

/* =====================================================
   🔵 APPEND (multi-rows/geral)
===================================================== */
export async function appendToSheet(range, values) {
  try {
    const rows = Array.isArray(values?.[0]) ? values : [values];

    await getSheetsClient().spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows }
    });

    return true;
  } catch (error) {
    console.error("❌ Erro ao append na planilha:", error);
    return false;
  }
}

/* =====================================================
   🔵 BATCH UPDATE DE VÁRIAS CÉLULAS DE UMA VEZ
   - updates: Array<{ range: "'Aba'!A1", value: any }>
===================================================== */
export async function batchUpdateValues(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return true;

  try {
    const data = updates.map(u => ({
      range: u.range,
      values: [[u.value]]
    }));

    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data
      }
    });

    return true;
  } catch (error) {
    console.error("❌ Erro no batchUpdateValues:", error);
    return false;
  }
}
