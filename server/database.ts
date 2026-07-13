export type QueryResult<Row> = { rows: Row[] }

export interface DatabaseClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<QueryResult<Row>>
  exec(sql: string): Promise<unknown>
}

export interface Database extends DatabaseClient {
  transaction<Result>(work: (database: DatabaseClient) => Promise<Result>): Promise<Result>
}

export function withDatabaseUser(database: Database, userId: string): Database {
  const configure = (client: DatabaseClient) => client.query(
    `SELECT set_config('app.current_user_id', $1, true)`, [userId],
  )
  return {
    query: <Row = Record<string, unknown>>(sql: string, parameters: unknown[] = []) => database.transaction(async (client) => {
      await configure(client)
      return client.query<Row>(sql, parameters)
    }),
    exec: (sql: string) => database.transaction(async (client) => {
      await configure(client)
      return client.exec(sql)
    }),
    transaction: <Result>(work: (client: DatabaseClient) => Promise<Result>) => database.transaction(async (client) => {
      await configure(client)
      return work(client)
    }),
  }
}
