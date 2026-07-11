-- ============================================================================
-- Migration v2 — Cutover Neon Fase 0 (2026-07-11)
-- Objetivo: o ESPELHO parar de DESCARTAR órfãos (serial fora da CONTROLE) e
-- passar a carregar os campos DENORMALIZADOS que o HISTORICO mostra (nome do
-- evento / produtora / comercial / ação crua / status congelado da col F).
-- Sem isso, um adapter de LEITURA no Neon perderia ~122 linhas e mostraria "-"
-- onde a planilha mostra texto. Ver docs/CUTOVER-NEON-2026-07-11.md §1.
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS / DROP NOT NULL). Não destrói dado.
-- As tabelas finais são TRUNCATE+reload a cada sync, então só a ESTRUTURA
-- persiste; o próximo sync v2 repovoa com os órfãos + campos crus.
-- ============================================================================

-- MOVIMENTO: aceitar órfão (maquina_id nulo) + serial + campos crus do HISTORICO
ALTER TABLE movimento ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS serial          TEXT;  -- serial cru (inclusive órfão)
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS acao_raw        TEXT;  -- col C crua ("Envio SP")
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS id_evento_raw   TEXT;  -- col B crua (inclusive "N/A")
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS status_raw      TEXT;  -- col F congelada (o app ignora, mas o shape mantém)
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS nome_evento_raw TEXT;  -- col H
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS produtora_raw   TEXT;  -- col I
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS comercial_raw   TEXT;  -- col J

-- PERDA: aceitar órfão + serial cru
ALTER TABLE perda ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE perda ADD COLUMN IF NOT EXISTS serial TEXT;

-- TROCA: aceitar defeito órfão + seriais crus
ALTER TABLE troca ALTER COLUMN maquina_defeito_id DROP NOT NULL;
ALTER TABLE troca ADD COLUMN IF NOT EXISTS serial_defeito TEXT;
ALTER TABLE troca ADD COLUMN IF NOT EXISTS serial_nova    TEXT;

-- LOCALIZACAO: aceitar órfão + serial cru
ALTER TABLE localizacao ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE localizacao ADD COLUMN IF NOT EXISTS serial TEXT;

-- MAQUINA: status cru (col G) + denormalizados da CONTROLE (col J/K/L/M crus) p/ o
-- adapter de leitura reproduzir getMaquinas byte-a-byte (inclusive id "N/A").
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS status_raw      TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS id_evento_raw   TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS nome_evento_raw TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS produtora_raw   TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS comercial_raw   TEXT;
