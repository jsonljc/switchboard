// Prisma 7 config — replaces the `datasource.url` schema field.
// https://pris.ly/d/prisma7-client-config
import path from "node:path";

export default {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
};
