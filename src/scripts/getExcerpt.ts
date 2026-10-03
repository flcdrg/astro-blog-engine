export default function getExcerpt(content: string, length: number) {
  const excerptParagraphs: string[] = [];
  let currentLength = 0;
  const paragraphs = content.match(/<p>.*?<\/p>/gs) || [];
  for (const paragraph of paragraphs) {
    // Strip HTML from the paragraph
    const text = paragraph.replace(/(<([^>]+)>)/gi, "");
    if (currentLength > 0 && currentLength + text.length > length) {
      break;
    }
    excerptParagraphs.push(text);
    currentLength += text.length;
  }
  const finalText = excerptParagraphs.join(" ").trim();

  if (finalText.length <= length - length * 0.1) {
    return finalText;
  }
  return finalText + ` \u2026`;
}
