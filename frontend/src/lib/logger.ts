import { createConsola } from "consola";

export const logger = createConsola({
  level: import.meta.env.PROD ? 1 : 4,
});
