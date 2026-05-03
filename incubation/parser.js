const fs = require('fs');

function parseHttpr(input) {
  // Use Unix LF \n as per the prompt design note
  const lines = input.split(/\r?\n/);

  if (lines.length === 0 || lines[0].trim() === '') {
    throw new Error('Invalid HTTP request: empty input');
  }

  // 1. Parse Request Line
  const requestLine = lines[0].trim();
  const requestLineParts = requestLine.split(' ');

  if (requestLineParts.length !== 3) {
    throw new Error('Invalid Request Line: must be in the format "[METHOD] [URI] [VERSION]"');
  }

  const [method, uri, version] = requestLineParts;

  // 2. Parse Headers
  const headers = [];
  let lineIndex = 1;
  let isMultipart = false;
  let boundary = null;
  let isUrlEncoded = false;

  while (lineIndex < lines.length && lines[lineIndex].trim() !== '') {
    const line = lines[lineIndex];
    // A colon might appear in the value, so we only split on the first colon
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid Header Line: missing colon in "${line}"`);
    }

    const name = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    headers.push({ name, value });

    if (name.toLowerCase() === 'content-type') {
      if (value.toLowerCase().includes('multipart/form-data')) {
         isMultipart = true;
         const match = value.match(/boundary=(.+)/i);
         if (match) {
             boundary = match[1];
         }
      } else if (value.toLowerCase().includes('application/x-www-form-urlencoded')) {
          isUrlEncoded = true;
      }
    }

    lineIndex++;
  }

  // Skip the blank line
  lineIndex++;

  // 3. Parse Body
  let body = undefined;
  if (lineIndex < lines.length) {
    const bodyContentLines = lines.slice(lineIndex);
    const bodyContent = bodyContentLines.join('\n');

    if (bodyContent.trim() !== '') {
      let bodyType = 'text';

      // Determine body type. This logic might need refinement based on exact reqs,
      // but 'text' is the default for json, xml, form-data.
      // If it contains a `<Binary Stream: path>` placeholder (from hydrated output), it's binary.
      // The prompt says IR JSON type should be "text", "base64", or "binary_stream".

      // For simplicity in incubation, let's look for the hydrated binary stream marker if we can,
      // but otherwise default to text as per most payloads.
      if (bodyContent.startsWith('<Binary Stream: ') && bodyContent.endsWith('>')) {
          bodyType = 'binary_stream';
      }

      body = {
        type: bodyType,
        content: bodyContent
      };
    }
  }

  // 4. Construct IR JSON
  const ir = {
    "schema-version": "1.0",
    method,
    uri,
    version,
    headers
  };

  if (body !== undefined) {
    ir.body = body;
  }

  return ir;
}

function main() {
  const inputFile = 'incubation/httpr.txt';
  const outputFile = 'incubation/httpr-ir.json';

  try {
    const inputContent = fs.readFileSync(inputFile, 'utf-8');
    const irObject = parseHttpr(inputContent);
    const outputContent = JSON.stringify(irObject, null, 2);

    fs.writeFileSync(outputFile, outputContent, 'utf-8');
    console.log(`Successfully parsed ${inputFile} and wrote to ${outputFile}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseHttpr };
