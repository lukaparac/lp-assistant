import { convertToModelMessages } from "ai";

const parts = [
  { type: "text", text: "What does the attached note say?" },
  {
    type: "file",
    url: "data:text/plain;base64,UkVWIElTIE9ORSBNSUxMSU9OLg==",
    filename: "a.txt",
    mediaType: "text/plain",
  },
];

const guard = (label, ms) =>
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`HUNG: ${label}`)), ms),
  );

try {
  console.time("convert");
  const out = await Promise.race([
    convertToModelMessages([{ id: "p1", role: "user", parts }]),
    guard("convertToModelMessages", 15000),
  ]);
  console.timeEnd("convert");
  console.log(JSON.stringify(out).slice(0, 500));
} catch (error) {
  console.log("FAILED:", error.message);
}
