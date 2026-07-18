CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(20) PRIMARY KEY,
    password_hash TEXT NOT NULL,
    personal_note TEXT NOT NULL DEFAULT '',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS current_chat (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(20) NOT NULL REFERENCES users(username),
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    image_expires_at TIMESTAMPTZ,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS history_archive (
    id BIGINT NOT NULL,
    username VARCHAR(20) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    image_expires_at TIMESTAMPTZ,
    timestamp TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS current_chat_timestamp_idx ON current_chat (timestamp DESC);

INSERT INTO users (username, password_hash, personal_note, is_admin)
VALUES ('test1', crypt('test1', gen_salt('bf', 10)), '', TRUE)
ON CONFLICT (username) DO UPDATE SET is_admin = TRUE;
