"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setUserStatus, updateSettings } from "@/lib/queries";
import { createDeps, processRaw } from "@/lib/intake";
import { requireLogin } from "./auth";

export async function changeStatus(form: FormData) {
  await requireLogin();
  const input = z
    .object({
      listingId: z.coerce.number().int().positive(),
      status: z.enum(["shortlisted", "rejected", "none"]),
    })
    .parse(Object.fromEntries(form));
  const result = await setUserStatus(input);
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/", "layout");
}
export async function pasteListing(form: FormData) {
  await requireLogin();
  const text = z.string().trim().min(1).max(30000).parse(form.get("text"));
  const result = await processRaw(await createDeps(), {
    channel: "paste",
    source: "paste",
    url: null,
    title: null,
    text,
    photoUrls: [],
    photoHashes: [],
  });
  revalidatePath("/", "layout");
  if (result.listingId) redirect(`/listing/${result.listingId}`);
  redirect(`/leads?result=${encodeURIComponent(result.status)}`);
}
export async function saveSettings(form: FormData) {
  await requireLogin();
  const input = z
    .object({
      officeAddress: z.string().trim().min(1),
      region: z.string().min(1),
      moveInEarliest: z.iso.date(),
      moveInLatest: z.iso.date(),
      startDate: z.iso.date(),
      moveOut: z.iso.date(),
      budgetCapCents: z.coerce.number().int().positive(),
      maxCommuteMinutes: z.coerce.number().int().positive(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/settings?result=Invalid+settings");
  const result = await updateSettings({
    ...input.data,
    requirePrivateBedroom: form.has("requirePrivateBedroom"),
    requirePrivateBath: form.has("requirePrivateBath"),
    requireFurnished: form.has("requireFurnished"),
  });
  revalidatePath("/", "layout");
  redirect(
    `/settings?result=${encodeURIComponent(result.ok ? `Saved. ${result.data.listingsRechecked} listings rechecked.` : result.error)}`,
  );
}
