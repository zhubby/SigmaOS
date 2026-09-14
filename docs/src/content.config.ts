import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema({
    extend: z.object({
      type: z.enum(["tutorial", "how-to", "explanation", "operation", "reference"]),
      status: z.enum(["current", "partial", "planned"]),
      audience: z.array(z.enum(["developer", "operator", "user"])).min(1),
      sourceOfTruth: z.array(z.string()).min(1)
    })
  })
});

export const collections = { docs };
