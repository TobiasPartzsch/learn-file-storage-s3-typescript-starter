import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import type { ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();
const MAX_UPLOAD_SIZE = 10 * 1 << 20;
const thumbnailWebKey = "thumbnail";

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const imageData = formData.get(thumbnailWebKey)
  if (!(imageData instanceof File)) {
    throw new BadRequestError("thumbnail is no file");
  }
  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`thumbnail file is too large (maximum size is ${MAX_UPLOAD_SIZE} bytes)`);
  }
  const mediaType = imageData.type;
  const buffer = await imageData.arrayBuffer();
  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Video not found");
  }
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("creator of the video isn't the currently logged in user");
  }
  videoThumbnails.set(videoId, { data: buffer, mediaType: mediaType },);
  videoMetadata.thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;
  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
