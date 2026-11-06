import { app } from "./app";
import { env } from "./config/env";

app.listen(env.port, "0.0.0.0", () => {
  console.log(`API escuchando en el puerto ${env.port}`);
});
