function parseArgs(argv) {
 
  const args = argv.slice(2);
  const command = args[0];
  let file = null;

  const flags = {};

  function setFlag(name, value) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      flags[name] = Array.isArray(flags[name]) ? flags[name].concat(value) : [flags[name], value];
      return;
    }
    flags[name] = value;
  }

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
      setFlag(flagName, true);
    }else {
      setFlag(flagName, nextValue);
      i++;
    }

  }
  
  return { command, file, flags };

}

module.exports = { parseArgs };
