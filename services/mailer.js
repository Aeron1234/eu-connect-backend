import { Resend } from "resend";
import { render } from "@react-email/render";
import { createElement } from "react";
import TempPasswordEmail from "../emails/TempPasswordEmail.js";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendTempPasswordEmail({
  to,
  username,
  tempPassword,
  expiresInMinutes,
}) {
  const html = await render(
    createElement(TempPasswordEmail, {
      username,
      tempPassword,
      expiresInMinutes,
    }),
  );

  await resend.emails.send({
    from: process.env.MAIL_FROM,
    to,
    subject: "Your temporary EU Connect password",
    html,
  });
}
