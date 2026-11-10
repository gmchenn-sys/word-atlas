import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Postgres migration enforces per-account isolation, CAS conflicts and idempotent writes", async () => {
  const db = await PGlite.create();
  const alice = "00000000-0000-4000-8000-000000000001";
  const bob = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`
   create role anon; create role authenticated;
   create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to authenticated,anon;
   insert into auth.users values ('${alice}'),('${bob}');
  `);
    await db.exec(
      await readFile(
        "supabase/migrations/202611100001_word_atlas_sync.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    const document = {
      progress: { version: 2, datasetId: "word-atlas-open", cards: {} },
      settings: {},
    };
    const commit = async (rev: number, id: string) => {
      const result = await db.query<{
        result: { applied: boolean; revision: number };
      }>(
        "select public.word_atlas_commit($1,$2,$3::jsonb,$4::uuid) as result",
        ["word-atlas-open", rev, JSON.stringify(document), id],
      );
      return result.rows[0].result;
    };
    const first = await commit(0, "10000000-0000-4000-8000-000000000001");
    assert.equal(first.applied, true);
    assert.equal(first.revision, 1);
    const repeat = await commit(0, "10000000-0000-4000-8000-000000000001");
    assert.equal(repeat.applied, true);
    assert.equal(repeat.revision, 1);
    const conflict = await commit(0, "10000000-0000-4000-8000-000000000002");
    assert.equal(conflict.applied, false);
    assert.equal(conflict.revision, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bob,
    ]);
    assert.equal(
      (await db.query("select * from public.word_atlas_progress")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.word_atlas_progress(user_id,dataset_id) values($1,$2)",
        [alice, "forbidden"],
      ),
      /row-level security/,
    );
    assert.equal(
      (await commit(0, "10000000-0000-4000-8000-000000000003")).applied,
      true,
    );
    const owned = await db.query<{ user_id: string }>(
      "select user_id from public.word_atlas_progress",
    );
    assert.deepEqual(owned.rows, [{ user_id: bob }]);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from public.word_atlas_progress"),
      /permission denied/,
    );
    await assert.rejects(
      commit(0, "10000000-0000-4000-8000-000000000004"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
