export default function getExcerpt(content: string, length: number) {
  var excerptParagraphs = [];
  var currentLength = 0;
  var paragraphs = content.match(/<p>.*?<\/p>/gs) || [];
  for (var _i = 0, paragraphs_1 = paragraphs; _i < paragraphs_1.length; _i++) {
    var paragraph = paragraphs_1[_i];
    // Strip HTML from the paragraph
    var text = paragraph?.replace(/(<([^>]+)>)/gi, "") ?? "";
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
