function parseArgs(argv) {
 
  const args = argv.slice(2);
  const command = args[0];
  let file = null;

  const flags = {};

  for (let i=1, len=args.length; i<len; i++) {
    const arg = args[i];

    if(!arg.startsWith('--')) {
      if (!file) {
        file = arg;
      }
      continue;
    }
    const flagName = arg.slice(2);
    const nextValue = args[i + 1];

    if(!nextValue || nextValue.startsWith('--')) {
      flags[flagName] = true;
    }else {
      flags[flagName] = nextValue;
      i++;
    }

  }
  
  return { command, file, flags };

}

module.exports = { parseArgs };
