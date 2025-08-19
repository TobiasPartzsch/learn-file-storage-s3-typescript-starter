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

const MAX_UPLOAD_SIZE = 10 * 1 << 20;
const thumbnailWebKey = "thumbnail";

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
  const buffer = Buffer.from(await imageData.arrayBuffer());
  const stringData = buffer.toString("base64");
  const dataURL = `data:${mediaType};base64,${stringData}`;
  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Video not found");
  }
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("creator of the video isn't the currently logged in user");
  }
  videoMetadata.thumbnailURL = dataURL
  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
