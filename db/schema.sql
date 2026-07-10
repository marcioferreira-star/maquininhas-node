-- ============================================================================
-- maquininhas-node — Schema Postgres/Neon (Onda 6, migração Sheets→Neon)
-- ----------------------------------------------------------------------------
-- Materializa o Plano B da auditoria (docs/AUDITORIA-2026-07-10.md).
-- Ainda NÃO aplicado — falta o projeto Neon + DATABASE_URL. Aplicar num branch
-- Neon limpo (fase 1). A curadoria dos dados (fase 2) usa o schema `staging`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
DROP TYPE IF EXISTS maquina_status CASCADE;
CREATE TYPE maquina_status AS ENUM ('ESTOQUE','EM_USO','FIXO','PERDIDA','DEFEITO','LOCALIZAR');

DROP TYPE IF EXISTS praca CASCADE;
CREATE TYPE praca AS ENUM ('SP','RJ','URA');

DROP TYPE IF EXISTS movimento_tipo CASCADE;
CREATE TYPE movimento_tipo AS ENUM ('ENVIO','ENVIO_FIXO','RETORNO','AJUSTE');

-- ----------------------------------------------------------------------------
-- EVENTO  (aba DADOS EVENTOS)
-- ----------------------------------------------------------------------------
CREATE TABLE evento (
  id_evento        BIGINT PRIMARY KEY,
  nome             TEXT NOT NULL,
  produtora_codigo INT,            -- separado do prefixo "572 | Nova Produtora"
  produtora_nome   TEXT,
  comercial        TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- MAQUINA  (aba CONTROLE) — fonte ÚNICA de identidade do parque
-- status/local DECOMPOSTOS (col G "Em Uso SP" vira status=EM_USO + local=SP)
-- ----------------------------------------------------------------------------
CREATE TABLE maquina (
  id               BIGSERIAL PRIMARY KEY,
  serial           VARCHAR(32) NOT NULL UNIQUE
                     CHECK (serial = btrim(serial) AND serial <> ''),
  modelo           TEXT,
  operadora        TEXT,           -- col D
  info_chip        TEXT,           -- col E
  empresa          TEXT NOT NULL DEFAULT 'Ingresse',
  adquirente       TEXT,           -- derivado do prefixo no import (PagSeguro/Stone/GetNet/Cielo)
  status           maquina_status NOT NULL,
  local            praca,          -- NULL quando FIXO/sem praça
  id_evento_atual  BIGINT REFERENCES evento(id_evento),
  data_saida       DATE,
  data_retorno     DATE,
  processando      BOOLEAN NOT NULL DEFAULT false,  -- col H
  observacao       TEXT,           -- col P
  origem_linha     INT,            -- linha original na CONTROLE (auditoria do import)
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- FIXO não tem retorno → adeus sentinela 01/01/2040
  CONSTRAINT maquina_fixo_sem_retorno CHECK (status <> 'FIXO' OR data_retorno IS NULL)
);
CREATE INDEX maquina_status_local_idx ON maquina (status, local);
CREATE INDEX maquina_evento_idx       ON maquina (id_evento_atual);

-- ----------------------------------------------------------------------------
-- MOVIMENTO  (aba HISTORICO MAQUINAS) — PK surrogate + created_at
-- "último movimento" deixa de depender da ordem física da linha.
-- ----------------------------------------------------------------------------
CREATE TABLE movimento (
  id            BIGSERIAL PRIMARY KEY,
  maquina_id    BIGINT NOT NULL REFERENCES maquina(id),
  id_evento     BIGINT REFERENCES evento(id_evento),
  tipo          movimento_tipo NOT NULL,
  local         praca,
  data_saida    DATE,
  data_retorno  DATE,
  usuario       TEXT,
  observacao    TEXT,
  origem        TEXT NOT NULL DEFAULT 'app',  -- 'app' | 'sheet_import' | 'sheet_sync'
  origem_linha  INT,                          -- linha original no HISTORICO
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movimento_maquina_idx ON movimento (maquina_id, criado_em DESC, id DESC);
CREATE INDEX movimento_evento_idx  ON movimento (id_evento);
-- NÃO existe coluna de "situação de prazo" (Atrasado/No prazo) — é DERIVADA (view abaixo).
-- Nome/produtora/comercial do movimento vêm por JOIN em evento, não são copiados.

-- ----------------------------------------------------------------------------
-- PERDA  (aba PERDIDAS) — col J é "Responsável" (≠ Produtora)
-- ----------------------------------------------------------------------------
CREATE TABLE perda (
  id            BIGSERIAL PRIMARY KEY,
  maquina_id    BIGINT NOT NULL REFERENCES maquina(id),
  id_evento     BIGINT REFERENCES evento(id_evento),
  responsavel   TEXT,
  comercial     TEXT,
  data_envio    DATE,
  status_perda  TEXT,          -- 'JURIDICO','MENSAL' (textos que estavam na col de DATA)
  local         TEXT,
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em  TIMESTAMPTZ    -- NULL = ainda perdida
);

-- ----------------------------------------------------------------------------
-- TROCA  (aba TROCAS) — defeituosa → nova
-- ----------------------------------------------------------------------------
CREATE TABLE troca (
  id                 BIGSERIAL PRIMARY KEY,
  maquina_defeito_id BIGINT NOT NULL REFERENCES maquina(id),
  problema           TEXT,
  local              TEXT,
  maquina_nova_id    BIGINT REFERENCES maquina(id),  -- NULL = defeito sem substituta ainda
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em       TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- LOCALIZACAO  (aba LOCALIZAR)
-- ----------------------------------------------------------------------------
CREATE TABLE localizacao (
  id            BIGSERIAL PRIMARY KEY,
  maquina_id    BIGINT NOT NULL REFERENCES maquina(id),
  referencia    TEXT,          -- texto livre da col Nome ("era pra ta aqui", "*ela voltou")
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  encontrado_em TIMESTAMPTZ    -- "*ela voltou" vira isto preenchido
);

-- ----------------------------------------------------------------------------
-- VIEW: situação de prazo AO VIVO (o bug de fuso morre por design — "hoje"
-- calculado em America/Sao_Paulo dentro do SQL, não no TZ do processo).
-- ----------------------------------------------------------------------------
CREATE VIEW vw_maquina_prazo AS
SELECT m.*,
       (m.status = 'EM_USO'
        AND m.data_retorno IS NOT NULL
        AND m.data_retorno < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS atrasada,
       (m.status = 'EM_USO' AND m.data_retorno IS NULL)                      AS prazo_indeterminado
FROM maquina m;

-- ----------------------------------------------------------------------------
-- STAGING (fase 2 do ETL): importa 100% das linhas cruas + parse + motivo_revisao.
-- Só linhas com motivo_revisao = '{}' (ou já decididas) são PROMOVIDAS ao public.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE staging.controle (
  origem_linha     INT,
  raw              JSONB,
  serial           TEXT,
  status_raw       TEXT,
  status           maquina_status,
  local            praca,
  id_evento_raw    TEXT,
  id_evento        BIGINT,
  data_saida_raw   TEXT,
  data_saida       DATE,
  data_retorno_raw TEXT,
  data_retorno     DATE,
  motivo_revisao   TEXT[] NOT NULL DEFAULT '{}'
);
-- (idem staging.historico, staging.eventos, staging.perdidas, staging.trocas,
--  staging.localizar — mesma ideia: raw + parseado + motivo_revisao)
