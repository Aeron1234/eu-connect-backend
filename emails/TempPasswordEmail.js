import { createElement as h } from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { LOGO_BASE64 } from "../config/emailAssets.js";

const MAROON = "#A30000";
const CREAM = "#FAF6F0";

export default function TempPasswordEmail({
  username,
  tempPassword,
  expiresInMinutes = 10,
}) {
  return h(
    Html,
    null,
    h(Head),
    h(Preview, null, "Your temporary EU Connect password"),
    h(
      Body,
      {
        style: {
          fontFamily: "Georgia, 'Times New Roman', Times, serif",
          backgroundColor: CREAM,
          margin: 0,
          padding: 0,
        },
      },
      h(
        Container,
        {
          style: {
            backgroundColor: "#ffffff",
            padding: "0",
            borderRadius: "10px",
            maxWidth: "480px",
            margin: "40px auto",
            overflow: "hidden",
            border: "1px solid #e7e0d8",
          },
        },
        // Header band, matching the Annex PDF header style
        h(
          Section,
          {
            style: {
              textAlign: "center",
              padding: "28px 32px 20px",
              borderBottom: `2px solid ${MAROON}`,
            },
          },
          h(Img, {
            src: LOGO_BASE64,
            width: "56",
            height: "56",
            alt: "MSEUF-CI Seal",
            style: { margin: "0 auto 10px" },
          }),
          h(
            Text,
            {
              style: {
                fontSize: "15px",
                fontWeight: "bold",
                color: MAROON,
                margin: "0",
                letterSpacing: "0.02em",
              },
            },
            "MANUEL S. ENVERGA UNIVERSITY FOUNDATION - CANDELARIA, INC.",
          ),
          h(
            Text,
            {
              style: {
                fontSize: "12px",
                color: MAROON,
                margin: "2px 0 0",
              },
            },
            "Quezon, Philippines",
          ),
        ),
        // Body
        h(
          Section,
          { style: { padding: "28px 32px" } },
          h(
            Text,
            {
              style: {
                fontSize: "16px",
                fontWeight: "bold",
                color: "#1c1917",
                margin: "0 0 12px",
              },
            },
            "Password reset requested",
          ),
          h(
            Text,
            {
              style: {
                fontSize: "14px",
                color: "#44403c",
                lineHeight: "1.6",
                margin: "0 0 18px",
              },
            },
            `Hi ${username}, paste the code below into the password field on the EU Connect login page. You'll be asked to set a new password right after signing in.`,
          ),
          h(
            Section,
            {
              style: {
                backgroundColor: CREAM,
                border: "1px solid #e7e0d8",
                borderRadius: "8px",
                padding: "16px 18px",
                wordBreak: "break-all",
                margin: "0 0 18px",
              },
            },
            h(
              Text,
              {
                style: {
                  fontSize: "12.5px",
                  fontFamily: "'Courier New', monospace",
                  color: "#1c1917",
                  margin: 0,
                },
              },
              tempPassword,
            ),
          ),
          h(
            Text,
            {
              style: {
                fontSize: "12.5px",
                color: "#78716c",
                lineHeight: "1.6",
                margin: 0,
              },
            },
            `This code expires in ${expiresInMinutes} minutes and can only be used once. If you didn't request this, you can safely ignore this email — your current password is unchanged.`,
          ),
        ),
        // Footer
        h(
          Section,
          {
            style: {
              padding: "16px 32px",
              borderTop: "1px solid #e7e0d8",
              textAlign: "center",
            },
          },
          h(
            Text,
            {
              style: { fontSize: "11px", color: "#a8a29e", margin: 0 },
            },
            "This is an automated message from EU Connect. Please do not reply.",
          ),
        ),
      ),
    ),
  );
}
