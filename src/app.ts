import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import routes from "./routes";
import { swaggerSpec } from "./docs/swagger";
import { errorHandler, notFound } from "./middlewares/errorHandler";

export const app = express();

app.use(helmet());
app.use(
  cors({
    // Solo los orígenes permitidos (p. ej. el dominio de Vercel). Sin lista = cualquiera (solo desarrollo).
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
  })
);
app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/", (_req, res) => res.redirect("/docs"));
app.use(routes);

app.use(notFound);
app.use(errorHandler);
