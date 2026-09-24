/** Bundled DDL. Vite resolves `?raw` to the file content; tsc sees the declaration in schema.d.ts. */
import schemaSql from "./schema.sql?raw";
import v2Sql from "./v2.sql?raw";
import v3Sql from "./v3.sql?raw";
import v4Sql from "./v4.sql?raw";
import v5Sql from "./v5.sql?raw";
import v6Sql from "./v6.sql?raw";

export const SCHEMA_SQL: string = schemaSql;
export const SCHEMA_V2_SQL: string = v2Sql;
export const SCHEMA_V3_SQL: string = v3Sql;
export const SCHEMA_V4_SQL: string = v4Sql;
export const SCHEMA_V5_SQL: string = v5Sql;
export const SCHEMA_V6_SQL: string = v6Sql;

import v7Sql from "./v7.sql?raw";
export const SCHEMA_V7_SQL: string = v7Sql;

import v8Sql from "./v8.sql?raw";
export const SCHEMA_V8_SQL: string = v8Sql;

import v9Sql from "./v9.sql?raw";
export const SCHEMA_V9_SQL: string = v9Sql;

import v10Sql from "./v10.sql?raw";
export const SCHEMA_V10_SQL: string = v10Sql;
