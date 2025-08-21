import type { BunRequest } from "bun";
import { randomBytes } from "crypto";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, mediaTypeToExt } from "./assets";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";
import { getVideoAspectRatio, processVideoForFastStart } from "./video-meta";

const MAX_UPLOAD_SIZE = 1 << 30;
const VIDEO_WEB_KEY = "video";
const VIDEO_MIME = "video/mp4";
const TEMP_VIDEO_NAME = "video";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log(`uploading video "${videoId}, by user "${userID}"`);

  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Video not found");
  }
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("creator of the video isn't the currently logged in user");
  }

  const formData = await req.formData();
  const videoData = formData.get(VIDEO_WEB_KEY)
  if (!(videoData instanceof File)) {
    throw new BadRequestError("video is no file");
  }
  if (videoData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`video file is too large (maximum size is ${MAX_UPLOAD_SIZE} bytes)`);
  }
  const mediaType = videoData.type;
  if (!mediaType || mediaType !== VIDEO_MIME) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const ext = mediaTypeToExt(mediaType);
  const filename = TEMP_VIDEO_NAME + ext;

  const tempFilePath = getAssetDiskPath(cfg, filename);
  let aspectRatio;
  let s3Key;

  let tempFile;
  let processedFile;
  try {
    await Bun.write(tempFilePath, videoData);
    tempFile = Bun.file(tempFilePath);

    const processedFilePath = await processVideoForFastStart(tempFilePath);
    processedFile = Bun.file(processedFilePath)

    aspectRatio = await getVideoAspectRatio(tempFilePath);
    s3Key = `${aspectRatio}/${randomBytes(32).toString("base64url")}${ext}`;

    const s3File = cfg.s3Client.file(s3Key);
    await s3File.write(
      processedFile,
      {
        type: mediaType,
      }
    );
  } finally {
    if (tempFile) {
      tempFile.delete();
    }
    if (processedFile) {
      processedFile.delete();
    }
  }

  const s3URL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`

  videoMetadata.videoURL = s3URL;
  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
