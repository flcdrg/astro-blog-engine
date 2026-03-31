import { getImage } from "astro:assets";

const rasterImagesGlob = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/**/*.{jpeg,jpg,png,gif,webp,avif}"
);

const svgImagesGlob = import.meta.glob<string>("/src/assets/**/*.svg", {
  query: "?url",
  import: "default",
});

export async function resolveFeedImageSrc(
  src: string,
  site: URL
): Promise<string | undefined> {
  if (src.startsWith("../../assets/")) {
    const assetPath = `/src/assets/${src.replace("../../assets/", "")}`;

    if (assetPath.endsWith(".svg")) {
      const svgPath = await svgImagesGlob[assetPath]?.();
      return svgPath ? new URL(svgPath, site).toString() : undefined;
    }

    const imagePath = await rasterImagesGlob[assetPath]?.()?.then(
      (res) => res.default
    );

    if (!imagePath) {
      return undefined;
    }

    const optimizedImg = await getImage({ src: imagePath });
    return new URL(optimizedImg.src, site).toString();
  }

  if (src.startsWith("/images")) {
    return new URL(src, site).toString();
  }

  if (/^https?:\/\//i.test(src)) {
    return src;
  }

  return undefined;
}