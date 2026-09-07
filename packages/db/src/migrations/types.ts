export interface Migration {
  id: string;
  sql: string;
  disableForeignKeys?: boolean;
}
