import multer from "multer";

const MB = 1024 * 1024;
const MAX_FIELDS = 50;

// Bound multipart file buffers, file/field counts and field sizes during receipt.
// Controllers still enforce their content and permission rules.
const policies = {
  document: {
    field: "file", maxFiles: 1, maxBytes: 10 * MB,
    sizeMessage: "File is too large (Max 10MB).",
    countMessage: "Choose one file to upload.",
  },
  certificate: {
    field: "file", maxFiles: 1, maxBytes: 50 * MB,
    sizeMessage: "File is too large (Max 50MB).",
    countMessage: "Choose one file to upload.",
  },
  summary: {
    field: "images", maxFiles: 6, maxBytes: 5 * MB,
    sizeMessage: "Each image must be 5 MB or smaller.",
    countMessage: "Choose up to six JPG, PNG, or WebP images.",
  },
};

function boundedUpload({ field, maxFiles, maxBytes, sizeMessage, countMessage }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      // Multer 2.4 handles Busboy's inclusive threshold internally. Configure
      // the actual maximum so even one byte over is rejected before handlers.
      fileSize: maxBytes,
      files: maxFiles,
      fields: MAX_FIELDS,
      fieldSize: MB,
      parts: MAX_FIELDS + maxFiles + 1,
    },
  });
  const parse = maxFiles === 1 ? upload.single(field) : upload.array(field, maxFiles);

  // Return expected size/count/malformed-body failures as JSON before controllers.
  // Unexpected parser errors continue to the central error handler.
  return (req, res, next) => parse(req, res, (error) => {
    if (!error) return next();
    let status = 400;
    let message;
    if (error instanceof multer.MulterError) {
      switch (error.code) {
        case "LIMIT_FILE_SIZE":
          status = 413;
          message = sizeMessage;
          break;
        case "LIMIT_FILE_COUNT":
        case "LIMIT_UNEXPECTED_FILE":
          message = countMessage;
          break;
        case "LIMIT_FIELD_VALUE":
        case "LIMIT_FIELD_KEY":
          status = 413;
          message = "Some upload details are too long. Shorten them and try again.";
          break;
        case "LIMIT_FIELD_COUNT":
        case "LIMIT_PART_COUNT":
          message = "Too many upload details. Please try again with fewer fields.";
          break;
        default:
          message = "Could not read the upload. Please try again.";
      }
    } else if (/^(?:Multipart:|Unexpected end of|Malformed part header)/i.test(error.message || "")) {
      message = "Could not read the upload. Please choose the file again and retry.";
    } else {
      return next(error);
    }
    return res.status(status).json({ success: false, error: message });
  });
}

export const acceptDocumentUpload = boundedUpload(policies.document);
export const acceptCertificateUpload = boundedUpload(policies.certificate);
export const acceptSummaryImages = boundedUpload(policies.summary);
export const acceptFeedbackAttachments = boundedUpload({ field: "attachments", maxFiles: 3, maxBytes: 5 * MB, sizeMessage: "Each attachment must be 5 MB or smaller.", countMessage: "Choose up to three PDF, PNG, JPG, or WebP attachments." });
