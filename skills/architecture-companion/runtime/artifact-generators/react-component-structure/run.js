import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/ignore@7.0.10/node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/.pnpm/ignore@7.0.10/node_modules/ignore/index.js"(exports, module) {
    "use strict";
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
    var REGEX_TEST_BLANK_LINE = /^\uFEFF? *$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var DOUBLE_SLASH = "//";
    var SLASH_CODE = 47;
    var DOT_CODE = 46;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var RETURN_FALSE = () => false;
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var POSIX_CLASSES = {
      alnum: "0-9A-Za-z",
      alpha: "A-Za-z",
      blank: " \\t",
      cntrl: "\\x00-\\x1f\\x7f",
      digit: "0-9",
      graph: "!-.0-~",
      lower: "a-z",
      print: " -.0-~",
      punct: "!-.:-@\\[-`{-~",
      // git's `sane-ctype.h` classifies \v and \f as control, not space,
      //   unlike C's `isspace`
      space: " \\t\\n\\r",
      upper: "A-Z",
      xdigit: "0-9A-Fa-f"
    };
    var CLASS_MEMBERS_TO_ESCAPE = "\\]^-[";
    var escapeMember = (char) => CLASS_MEMBERS_TO_ESCAPE.indexOf(char) < 0 ? char : ESCAPE + char;
    var NON_SLASH = "(?!\\/)";
    var classSource = (negated, body) => {
      if (negated) {
        return `[^\\/${body}]`;
      }
      const source = `[${body}]`;
      return new RegExp(source).test("/") ? NON_SLASH + source : source;
    };
    var scanBracket = (pattern, start) => {
      const { length } = pattern;
      let index = start + 1;
      let negated = EMPTY;
      const lead = pattern[index];
      if (lead === "!" || lead === "^") {
        negated = "^";
        index++;
      }
      let body = EMPTY;
      let prev = EMPTY;
      for (; ; ) {
        const char = pattern[index];
        if (char === UNDEFINED) {
          return null;
        }
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === UNDEFINED) {
            return null;
          }
          body += escapeMember(escaped);
          prev = escaped;
          index++;
        } else if (char === "-" && prev && index + 1 < length && pattern[index + 1] !== "]") {
          index++;
          let to = pattern[index];
          if (to === ESCAPE) {
            to = pattern[index += 1];
          }
          if (prev <= to) {
            body += `-${escapeMember(to)}`;
          }
          prev = EMPTY;
        } else if (char === "[" && pattern[index + 1] === ":") {
          const nameStart = index + 2;
          let end = nameStart;
          while (end < length && pattern[end] !== "]") {
            end++;
          }
          if (end === length) {
            return null;
          }
          if (end > nameStart && pattern[end - 1] === ":") {
            const expanded = POSIX_CLASSES[pattern.slice(nameStart, end - 1)];
            if (expanded === UNDEFINED) {
              return null;
            }
            body += expanded;
            prev = EMPTY;
            index = end;
          } else {
            body += escapeMember("[");
            prev = "[";
            index = nameStart - 2;
          }
        } else {
          body += escapeMember(char);
          prev = char;
        }
        index++;
        if (pattern[index] === "]") {
          return {
            end: index,
            source: classSource(negated, body)
          };
        }
      }
    };
    var NEVER_MATCH = "[]";
    var PLACEHOLDER = "\0";
    var REGEX_RESTORE_PLACEHOLDER = new RegExp(
      `${PLACEHOLDER}(\\d+)${PLACEHOLDER}`,
      "g"
    );
    var TRAILING_WILDCARD = "\uE000";
    var extractBrackets = (pattern) => {
      const sources = [];
      const hold = (source) => `${PLACEHOLDER}${sources.push(source) - 1}${PLACEHOLDER}`;
      const { length } = pattern;
      let out = EMPTY;
      let index = 0;
      while (index < length) {
        const char = pattern[index];
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === "*" || escaped === "[" || escaped === SPACE || escaped === ESCAPE) {
            out += pattern.slice(index, index + 2);
          } else {
            out += hold(
              REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped
            );
          }
          index += 2;
        } else if (char === PLACEHOLDER) {
          out += hold(`[${PLACEHOLDER}]`);
          index++;
        } else if (char === "[") {
          const scanned = scanBracket(pattern, index);
          if (scanned === null) {
            out += hold(NEVER_MATCH);
            index = length;
          } else {
            out += hold(scanned.source);
            index = scanned.end + 1;
          }
        } else {
          out += char;
          index++;
        }
      }
      return {
        source: out,
        sources
      };
    };
    var DIRECT = null;
    var REGEX_INNER_SLASH = /\/(?!$)/;
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY,
        "\uFEFF"
      ],
      [
        // A trailing line terminator, left on when a whole file's contents are
        //   added as one pattern rather than split into lines. git never sees one
        //   -- it reads a `.gitignore` line by line -- so it is not part of the
        //   pattern and is dropped here, apart from the trailing-space trimming,
        //   which follows git in touching spaces and nothing else.
        /[\r\n]+$/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // Only spaces, never tabs or other whitespace: git trims a trailing run
        //   of `' '` and nothing else (dir.c, `trim_trailing_spaces`, a single
        //   `case ' '`), so a pattern ending in a tab keeps it as a literal.
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\? +)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // Only a space: an escaped tab or other whitespace is already a literal by
      //   the time it reaches here, and a bare tab must be left as one, not turned
      //   into a space.
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?) /g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]",
        "?"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^",
        SLASH
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/",
        SLASH
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*(?:\\\*\\\*\\\/)+/,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?",
        "*"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        DIRECT,
        (source, pattern) => {
          if (!source || source[0] === "^") {
            return source;
          }
          const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
          return anchor + source;
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? str.slice(index + 6) === "\\/" ? "(?:\\/[^\\/]+)+" : "(?:\\/[^\\/]+)*" : "\\/.+",
        "*"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        },
        "*"
      ],
      // trailing wildcard, held apart from a literal star
      [
        // The step above leaves a trailing `*` alone, so a single `\*` is all that
        //   can be left at the end here. Whether it is a wildcard or a literal
        //   turns on the backslashes the user put in front of it: the escaper has
        //   since doubled every one, so what stands here is those `2N` doubled
        //   backslashes and then the star's own escape. An even number of the
        //   original `N` leaves the star unescaped -- a wildcard -- and an odd
        //   number escapes it -- a literal. This runs while the two are still
        //   distinct, before the unescape steps below collapse the literal onto
        //   the very `\*` a wildcard leaves behind.
        /(^|[^\\])((?:\\\\)*)\\\*$/,
        (match, p1, p2) => (
          // `p2` holds the doubled user backslashes; half of them is `N`.
          p2.length / 2 % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match
        ),
        "*"
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // Every real bracket expression -- POSIX classes included -- has already
        //   been held aside by `extractBrackets`, so the only `[` left in the
        //   pattern is an escaped, literal one.
        // `\` is escaped by step 3
        /\\\[([^\]/]*?)(\\*)($|\])/g,
        // '\\[bar]' -> '\\\\[bar\\]'
        (match, range, endEscape, close) => `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`,
        "["
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        DIRECT,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (source) => {
          const last = source[source.length - 1];
          if (!last || last === TRAILING_WILDCARD) {
            return source;
          }
          return last === SLASH ? `${source}$` : `${source}(?=$|\\/$)`;
        }
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var WILDCARD = "[^\\/]*";
    var separatorAfter = (run, at) => {
      let separator = EMPTY;
      for (let index = at + 1; index < run.length && !run[index].wildcard; index++) {
        separator += run[index].single;
      }
      return separator;
    };
    var pinWildcards = (source) => {
      if (source.indexOf(WILDCARD) < 0) {
        return source;
      }
      const tokens = [];
      const { length } = source;
      let index = 0;
      while (index < length) {
        const char = source[index];
        if (source.startsWith(WILDCARD, index)) {
          tokens.push({ wildcard: true });
          index += WILDCARD.length;
        } else if (char === "[") {
          let end = index + 1;
          if (source[end] === "^") {
            end++;
          }
          if (source[end] === "]") {
            end++;
          }
          while (end < length && source[end] !== "]") {
            end += source[end] === ESCAPE ? 2 : 1;
          }
          end++;
          tokens.push({ single: source.slice(index, end) });
          index = end;
        } else if (char === ESCAPE) {
          tokens.push({ single: source.slice(index, index + 2) });
          index += 2;
        } else if (char === "(") {
          let depth = 0;
          let end = index;
          do {
            if (source[end] === ESCAPE) {
              end++;
            } else if (source[end] === "(") {
              depth++;
            } else if (source[end] === ")") {
              depth--;
            }
            end++;
          } while (end < length && depth > 0);
          if ("*+?".indexOf(source[end]) >= 0) {
            end++;
          }
          tokens.push({ boundary: source.slice(index, end) });
          index = end;
        } else if (char === "^" || char === "$") {
          tokens.push({ boundary: char });
          index++;
        } else {
          tokens.push({ single: char });
          index++;
        }
      }
      let out = EMPTY;
      let run = [];
      const flush = () => {
        let lastWildcard;
        run.forEach((token, at) => {
          if (token.wildcard) {
            lastWildcard = at;
          }
        });
        run.forEach((token, at) => {
          if (!token.wildcard) {
            out += token.single;
            return;
          }
          out += at === lastWildcard ? WILDCARD : `(?:(?!${separatorAfter(run, at)})[^\\/])*`;
        });
        run = [];
      };
      tokens.forEach((token) => {
        if (token.boundary === void 0) {
          run.push(token);
          return;
        }
        flush();
        out += token.boundary;
      });
      flush();
      return out;
    };
    var makeRegexPrefix = (pattern) => {
      const { source, sources } = extractBrackets(pattern);
      const replaced = REPLACERS.reduce(
        // A pass whose matcher finds nothing hands back the very string it was
        //   given, so asking first costs a search and saves a rewrite. Ten of the
        //   fifteen passes never fire for a typical .gitignore line, and between
        //   them they were 45% of this chain.
        (prev, [matcher, replacer, required]) => {
          if (matcher === DIRECT) {
            return replacer(prev, pattern);
          }
          if (required !== UNDEFINED && prev.indexOf(required) < 0) {
            return prev;
          }
          return matcher.test(prev) ? prev.replace(matcher, replacer.bind(pattern)) : prev;
        },
        source
      );
      return sources.length ? replaced.replace(
        REGEX_RESTORE_PLACEHOLDER,
        (match, index) => sources[index]
      ) : replaced;
    };
    var matchesBasename = (body) => {
      const index = body.indexOf(SLASH);
      return index < 0 || index === body.length - 1;
    };
    var basenameOf = (path) => {
      const end = path.length - 1;
      const index = path.lastIndexOf(
        SLASH,
        path[end] === SLASH ? end - 1 : end
      );
      return index < 0 ? path : path.slice(index + 1);
    };
    var parentOf = (path) => {
      if (path.charCodeAt(0) === SLASH_CODE || path.indexOf(DOUBLE_SLASH) >= 0) {
        const slices = path.split(SLASH).filter(Boolean);
        slices.pop();
        return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
      }
      const end = path.length - 1;
      const cut = path.lastIndexOf(
        SLASH,
        path.charCodeAt(end) === SLASH_CODE ? end - 1 : end
      );
      return cut < 0 ? EMPTY : path.slice(0, cut + 1);
    };
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      // Worked out on first use and kept behind an own property, the way `regex`
      //   caches itself in `_regex`. Deciding it in the constructor instead would
      //   add a fourth `defineProperty` to every rule ever built, which cost 4% of
      //   every compile -- including the compiles of rules that are never matched
      //   against anything.
      get _basenameOnly() {
        return define(this, "_basenameOnly", matchesBasename(this.body));
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = pinWildcards(this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        ));
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
        this._basenameCount = 0;
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._basenameCount += pattern._rules._basenameCount;
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
          if (matchesBasename(rule.body)) {
            this._basenameCount++;
          }
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        const rules = this._rules;
        const { length } = rules;
        const shortcut = this._basenameCount * 2 >= length;
        const basename2 = shortcut ? basenameOf(path) : path;
        for (let index = 0; index < length; index++) {
          const rule = rules[index];
          const { negative } = rule;
          const skip = unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored;
          if (!skip && rule[mode].test(
            shortcut && rule._basenameOnly ? basename2 : path
          )) {
            ignored = !negative;
            unignored = negative;
            matchedRule = negative ? UNDEFINED : rule;
          }
        }
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path, originalPath, doThrow) => {
      if (!isString(path)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path) => {
      const first = path.charCodeAt(0);
      if (first === SLASH_CODE) {
        return true;
      }
      if (first !== DOT_CODE) {
        return false;
      }
      if (path.length === 1) {
        return true;
      }
      const second = path.charCodeAt(1);
      if (second === SLASH_CODE) {
        return true;
      }
      if (second !== DOT_CODE) {
        return false;
      }
      return path.length === 2 || path.charCodeAt(2) === SLASH_CODE;
    };
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored) {
        const path = originalPath && checkPath.convert(originalPath);
        checkPath(
          path,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path, cache, checkUnignored);
      }
      checkIgnore(path) {
        if (path.charCodeAt(path.length - 1) !== SLASH_CODE) {
          return this.test(path);
        }
        const parentPath = parentOf(path);
        if (parentPath) {
          const parent = this._t(parentPath, this._testCache, true);
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path, false, MODE_CHECK_IGNORE);
      }
      _t(path, cache, checkUnignored) {
        if (path in cache) {
          return cache[path];
        }
        const parentPath = parentOf(path);
        const parent = parentPath ? this._t(parentPath, cache, checkUnignored) : UNDEFINED;
        return cache[path] = parent && parent.ignored ? parent : this._rules.test(path, checkUnignored, MODE_IGNORE);
      }
      ignores(path) {
        return this._test(path, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path) => !this.ignores(path);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path) {
        return this._test(path, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path) => checkPath(path && checkPath.convert(path), path, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path) || isNotRelative(path);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module.exports = factory;
    factory.default = factory;
    module.exports.isPathValid = isPathValid;
    define(module.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/utils.js"(exports) {
    "use strict";
    exports.isInteger = (num) => {
      if (typeof num === "number") {
        return Number.isInteger(num);
      }
      if (typeof num === "string" && num.trim() !== "") {
        return Number.isInteger(Number(num));
      }
      return false;
    };
    exports.find = (node, type) => node.nodes.find((node2) => node2.type === type);
    exports.exceedsLimit = (min, max, step = 1, limit) => {
      if (limit === false) return false;
      if (!exports.isInteger(min) || !exports.isInteger(max)) return false;
      return (Number(max) - Number(min)) / Number(step) >= limit;
    };
    exports.escapeNode = (block, n = 0, type) => {
      const node = block.nodes[n];
      if (!node) return;
      if (type && node.type === type || node.type === "open" || node.type === "close") {
        if (node.escaped !== true) {
          node.value = "\\" + node.value;
          node.escaped = true;
        }
      }
    };
    exports.encloseBrace = (node) => {
      if (node.type !== "brace") return false;
      if (node.commas >> 0 + node.ranges >> 0 === 0) {
        node.invalid = true;
        return true;
      }
      return false;
    };
    exports.isInvalidBrace = (block) => {
      if (block.type !== "brace") return false;
      if (block.invalid === true || block.dollar) return true;
      if (block.commas >> 0 + block.ranges >> 0 === 0) {
        block.invalid = true;
        return true;
      }
      if (block.open !== true || block.close !== true) {
        block.invalid = true;
        return true;
      }
      return false;
    };
    exports.isOpenOrClose = (node) => {
      if (node.type === "open" || node.type === "close") {
        return true;
      }
      return node.open === true || node.close === true;
    };
    exports.reduce = (nodes) => nodes.reduce((acc, node) => {
      if (node.type === "text") acc.push(node.value);
      if (node.type === "range") node.type = "text";
      return acc;
    }, []);
    exports.flatten = (...args) => {
      const result = [];
      const flat = (arr) => {
        for (let i = 0; i < arr.length; i++) {
          const ele = arr[i];
          if (Array.isArray(ele)) {
            flat(ele);
            continue;
          }
          if (ele !== void 0) {
            result.push(ele);
          }
        }
        return result;
      };
      flat(args);
      return result;
    };
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/stringify.js"(exports, module) {
    "use strict";
    var utils = require_utils();
    module.exports = (ast, options = {}) => {
      const stringify = (node, parent = {}) => {
        const invalidBlock = options.escapeInvalid && utils.isInvalidBrace(parent);
        const invalidNode = node.invalid === true && options.escapeInvalid === true;
        let output = "";
        if (node.value) {
          if ((invalidBlock || invalidNode) && utils.isOpenOrClose(node)) {
            return "\\" + node.value;
          }
          return node.value;
        }
        if (node.value) {
          return node.value;
        }
        if (node.nodes) {
          for (const child of node.nodes) {
            output += stringify(child);
          }
        }
        return output;
      };
      return stringify(ast);
    };
  }
});

// node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js
var require_is_number = __commonJS({
  "node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js"(exports, module) {
    "use strict";
    module.exports = function(num) {
      if (typeof num === "number") {
        return num - num === 0;
      }
      if (typeof num === "string" && num.trim() !== "") {
        return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);
      }
      return false;
    };
  }
});

// node_modules/.pnpm/to-regex-range@5.0.1/node_modules/to-regex-range/index.js
var require_to_regex_range = __commonJS({
  "node_modules/.pnpm/to-regex-range@5.0.1/node_modules/to-regex-range/index.js"(exports, module) {
    "use strict";
    var isNumber = require_is_number();
    var toRegexRange = (min, max, options) => {
      if (isNumber(min) === false) {
        throw new TypeError("toRegexRange: expected the first argument to be a number");
      }
      if (max === void 0 || min === max) {
        return String(min);
      }
      if (isNumber(max) === false) {
        throw new TypeError("toRegexRange: expected the second argument to be a number.");
      }
      let opts = { relaxZeros: true, ...options };
      if (typeof opts.strictZeros === "boolean") {
        opts.relaxZeros = opts.strictZeros === false;
      }
      let relax = String(opts.relaxZeros);
      let shorthand = String(opts.shorthand);
      let capture = String(opts.capture);
      let wrap = String(opts.wrap);
      let cacheKey = min + ":" + max + "=" + relax + shorthand + capture + wrap;
      if (toRegexRange.cache.hasOwnProperty(cacheKey)) {
        return toRegexRange.cache[cacheKey].result;
      }
      let a = Math.min(min, max);
      let b = Math.max(min, max);
      if (Math.abs(a - b) === 1) {
        let result = min + "|" + max;
        if (opts.capture) {
          return `(${result})`;
        }
        if (opts.wrap === false) {
          return result;
        }
        return `(?:${result})`;
      }
      let isPadded = hasPadding(min) || hasPadding(max);
      let state = { min, max, a, b };
      let positives = [];
      let negatives = [];
      if (isPadded) {
        state.isPadded = isPadded;
        state.maxLen = String(state.max).length;
      }
      if (a < 0) {
        let newMin = b < 0 ? Math.abs(b) : 1;
        negatives = splitToPatterns(newMin, Math.abs(a), state, opts);
        a = state.a = 0;
      }
      if (b >= 0) {
        positives = splitToPatterns(a, b, state, opts);
      }
      state.negatives = negatives;
      state.positives = positives;
      state.result = collatePatterns(negatives, positives, opts);
      if (opts.capture === true) {
        state.result = `(${state.result})`;
      } else if (opts.wrap !== false && positives.length + negatives.length > 1) {
        state.result = `(?:${state.result})`;
      }
      toRegexRange.cache[cacheKey] = state;
      return state.result;
    };
    function collatePatterns(neg, pos, options) {
      let onlyNegative = filterPatterns(neg, pos, "-", false, options) || [];
      let onlyPositive = filterPatterns(pos, neg, "", false, options) || [];
      let intersected = filterPatterns(neg, pos, "-?", true, options) || [];
      let subpatterns = onlyNegative.concat(intersected).concat(onlyPositive);
      return subpatterns.join("|");
    }
    function splitToRanges(min, max) {
      let nines = 1;
      let zeros = 1;
      let stop = countNines(min, nines);
      let stops = /* @__PURE__ */ new Set([max]);
      while (min <= stop && stop <= max) {
        stops.add(stop);
        nines += 1;
        stop = countNines(min, nines);
      }
      stop = countZeros(max + 1, zeros) - 1;
      while (min < stop && stop <= max) {
        stops.add(stop);
        zeros += 1;
        stop = countZeros(max + 1, zeros) - 1;
      }
      stops = [...stops];
      stops.sort(compare);
      return stops;
    }
    function rangeToPattern(start, stop, options) {
      if (start === stop) {
        return { pattern: start, count: [], digits: 0 };
      }
      let zipped = zip(start, stop);
      let digits = zipped.length;
      let pattern = "";
      let count = 0;
      for (let i = 0; i < digits; i++) {
        let [startDigit, stopDigit] = zipped[i];
        if (startDigit === stopDigit) {
          pattern += startDigit;
        } else if (startDigit !== "0" || stopDigit !== "9") {
          pattern += toCharacterClass(startDigit, stopDigit, options);
        } else {
          count++;
        }
      }
      if (count) {
        pattern += options.shorthand === true ? "\\d" : "[0-9]";
      }
      return { pattern, count: [count], digits };
    }
    function splitToPatterns(min, max, tok, options) {
      let ranges = splitToRanges(min, max);
      let tokens = [];
      let start = min;
      let prev;
      for (let i = 0; i < ranges.length; i++) {
        let max2 = ranges[i];
        let obj = rangeToPattern(String(start), String(max2), options);
        let zeros = "";
        if (!tok.isPadded && prev && prev.pattern === obj.pattern) {
          if (prev.count.length > 1) {
            prev.count.pop();
          }
          prev.count.push(obj.count[0]);
          prev.string = prev.pattern + toQuantifier(prev.count);
          start = max2 + 1;
          continue;
        }
        if (tok.isPadded) {
          zeros = padZeros(max2, tok, options);
        }
        obj.string = zeros + obj.pattern + toQuantifier(obj.count);
        tokens.push(obj);
        start = max2 + 1;
        prev = obj;
      }
      return tokens;
    }
    function filterPatterns(arr, comparison, prefix, intersection, options) {
      let result = [];
      for (let ele of arr) {
        let { string } = ele;
        if (!intersection && !contains(comparison, "string", string)) {
          result.push(prefix + string);
        }
        if (intersection && contains(comparison, "string", string)) {
          result.push(prefix + string);
        }
      }
      return result;
    }
    function zip(a, b) {
      let arr = [];
      for (let i = 0; i < a.length; i++) arr.push([a[i], b[i]]);
      return arr;
    }
    function compare(a, b) {
      return a > b ? 1 : b > a ? -1 : 0;
    }
    function contains(arr, key, val) {
      return arr.some((ele) => ele[key] === val);
    }
    function countNines(min, len) {
      return Number(String(min).slice(0, -len) + "9".repeat(len));
    }
    function countZeros(integer, zeros) {
      return integer - integer % Math.pow(10, zeros);
    }
    function toQuantifier(digits) {
      let [start = 0, stop = ""] = digits;
      if (stop || start > 1) {
        return `{${start + (stop ? "," + stop : "")}}`;
      }
      return "";
    }
    function toCharacterClass(a, b, options) {
      return `[${a}${b - a === 1 ? "" : "-"}${b}]`;
    }
    function hasPadding(str) {
      return /^-?(0+)\d/.test(str);
    }
    function padZeros(value, tok, options) {
      if (!tok.isPadded) {
        return value;
      }
      let diff = Math.abs(tok.maxLen - String(value).length);
      let relax = options.relaxZeros !== false;
      switch (diff) {
        case 0:
          return "";
        case 1:
          return relax ? "0?" : "0";
        case 2:
          return relax ? "0{0,2}" : "00";
        default: {
          return relax ? `0{0,${diff}}` : `0{${diff}}`;
        }
      }
    }
    toRegexRange.cache = {};
    toRegexRange.clearCache = () => toRegexRange.cache = {};
    module.exports = toRegexRange;
  }
});

// node_modules/.pnpm/fill-range@7.1.1/node_modules/fill-range/index.js
var require_fill_range = __commonJS({
  "node_modules/.pnpm/fill-range@7.1.1/node_modules/fill-range/index.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var toRegexRange = require_to_regex_range();
    var isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    var transform = (toNumber) => {
      return (value) => toNumber === true ? Number(value) : String(value);
    };
    var isValidValue = (value) => {
      return typeof value === "number" || typeof value === "string" && value !== "";
    };
    var isNumber = (num) => Number.isInteger(+num);
    var zeros = (input) => {
      let value = `${input}`;
      let index = -1;
      if (value[0] === "-") value = value.slice(1);
      if (value === "0") return false;
      while (value[++index] === "0") ;
      return index > 0;
    };
    var stringify = (start, end, options) => {
      if (typeof start === "string" || typeof end === "string") {
        return true;
      }
      return options.stringify === true;
    };
    var pad = (input, maxLength, toNumber) => {
      if (maxLength > 0) {
        let dash = input[0] === "-" ? "-" : "";
        if (dash) input = input.slice(1);
        input = dash + input.padStart(dash ? maxLength - 1 : maxLength, "0");
      }
      if (toNumber === false) {
        return String(input);
      }
      return input;
    };
    var toMaxLen = (input, maxLength) => {
      let negative = input[0] === "-" ? "-" : "";
      if (negative) {
        input = input.slice(1);
        maxLength--;
      }
      while (input.length < maxLength) input = "0" + input;
      return negative ? "-" + input : input;
    };
    var toSequence = (parts, options, maxLen) => {
      parts.negatives.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      parts.positives.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      let prefix = options.capture ? "" : "?:";
      let positives = "";
      let negatives = "";
      let result;
      if (parts.positives.length) {
        positives = parts.positives.map((v) => toMaxLen(String(v), maxLen)).join("|");
      }
      if (parts.negatives.length) {
        negatives = `-(${prefix}${parts.negatives.map((v) => toMaxLen(String(v), maxLen)).join("|")})`;
      }
      if (positives && negatives) {
        result = `${positives}|${negatives}`;
      } else {
        result = positives || negatives;
      }
      if (options.wrap) {
        return `(${prefix}${result})`;
      }
      return result;
    };
    var toRange = (a, b, isNumbers, options) => {
      if (isNumbers) {
        return toRegexRange(a, b, { wrap: false, ...options });
      }
      let start = String.fromCharCode(a);
      if (a === b) return start;
      let stop = String.fromCharCode(b);
      return `[${start}-${stop}]`;
    };
    var toRegex = (start, end, options) => {
      if (Array.isArray(start)) {
        let wrap = options.wrap === true;
        let prefix = options.capture ? "" : "?:";
        return wrap ? `(${prefix}${start.join("|")})` : start.join("|");
      }
      return toRegexRange(start, end, options);
    };
    var rangeError = (...args) => {
      return new RangeError("Invalid range arguments: " + util.inspect(...args));
    };
    var invalidRange = (start, end, options) => {
      if (options.strictRanges === true) throw rangeError([start, end]);
      return [];
    };
    var invalidStep = (step, options) => {
      if (options.strictRanges === true) {
        throw new TypeError(`Expected step "${step}" to be a number`);
      }
      return [];
    };
    var fillNumbers = (start, end, step = 1, options = {}) => {
      let a = Number(start);
      let b = Number(end);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        if (options.strictRanges === true) throw rangeError([start, end]);
        return [];
      }
      if (a === 0) a = 0;
      if (b === 0) b = 0;
      let descending = a > b;
      let startString = String(start);
      let endString = String(end);
      let stepString = String(step);
      step = Math.max(Math.abs(step), 1);
      let padded = zeros(startString) || zeros(endString) || zeros(stepString);
      let maxLen = padded ? Math.max(startString.length, endString.length, stepString.length) : 0;
      let toNumber = padded === false && stringify(start, end, options) === false;
      let format = options.transform || transform(toNumber);
      if (options.toRegex && step === 1) {
        return toRange(toMaxLen(start, maxLen), toMaxLen(end, maxLen), true, options);
      }
      let parts = { negatives: [], positives: [] };
      let push = (num) => parts[num < 0 ? "negatives" : "positives"].push(Math.abs(num));
      let range = [];
      let index = 0;
      while (descending ? a >= b : a <= b) {
        if (options.toRegex === true && step > 1) {
          push(a);
        } else {
          range.push(pad(format(a, index), maxLen, toNumber));
        }
        a = descending ? a - step : a + step;
        index++;
      }
      if (options.toRegex === true) {
        return step > 1 ? toSequence(parts, options, maxLen) : toRegex(range, null, { wrap: false, ...options });
      }
      return range;
    };
    var fillLetters = (start, end, step = 1, options = {}) => {
      if (!isNumber(start) && start.length > 1 || !isNumber(end) && end.length > 1) {
        return invalidRange(start, end, options);
      }
      let format = options.transform || ((val) => String.fromCharCode(val));
      let a = `${start}`.charCodeAt(0);
      let b = `${end}`.charCodeAt(0);
      let descending = a > b;
      let min = Math.min(a, b);
      let max = Math.max(a, b);
      if (options.toRegex && step === 1) {
        return toRange(min, max, false, options);
      }
      let range = [];
      let index = 0;
      while (descending ? a >= b : a <= b) {
        range.push(format(a, index));
        a = descending ? a - step : a + step;
        index++;
      }
      if (options.toRegex === true) {
        return toRegex(range, null, { wrap: false, options });
      }
      return range;
    };
    var fill = (start, end, step, options = {}) => {
      if (end == null && isValidValue(start)) {
        return [start];
      }
      if (!isValidValue(start) || !isValidValue(end)) {
        return invalidRange(start, end, options);
      }
      if (typeof step === "function") {
        return fill(start, end, 1, { transform: step });
      }
      if (isObject(step)) {
        return fill(start, end, 0, step);
      }
      let opts = { ...options };
      if (opts.capture === true) opts.wrap = true;
      step = step || opts.step || 1;
      if (!isNumber(step)) {
        if (step != null && !isObject(step)) return invalidStep(step, opts);
        return fill(start, end, 1, step);
      }
      if (isNumber(start) && isNumber(end)) {
        return fillNumbers(start, end, step, opts);
      }
      return fillLetters(start, end, Math.max(Math.abs(step), 1), opts);
    };
    module.exports = fill;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/compile.js
var require_compile = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/compile.js"(exports, module) {
    "use strict";
    var fill = require_fill_range();
    var utils = require_utils();
    var compile = (ast, options = {}) => {
      const walk = (node, parent = {}) => {
        const invalidBlock = utils.isInvalidBrace(parent);
        const invalidNode = node.invalid === true && options.escapeInvalid === true;
        const invalid = invalidBlock === true || invalidNode === true;
        const prefix = options.escapeInvalid === true ? "\\" : "";
        let output = "";
        if (node.isOpen === true) {
          return prefix + node.value;
        }
        if (node.isClose === true) {
          console.log("node.isClose", prefix, node.value);
          return prefix + node.value;
        }
        if (node.type === "open") {
          return invalid ? prefix + node.value : "(";
        }
        if (node.type === "close") {
          return invalid ? prefix + node.value : ")";
        }
        if (node.type === "comma") {
          return node.prev.type === "comma" ? "" : invalid ? node.value : "|";
        }
        if (node.value) {
          return node.value;
        }
        if (node.nodes && node.ranges > 0) {
          const args = utils.reduce(node.nodes);
          const range = fill(...args, { ...options, wrap: false, toRegex: true, strictZeros: true });
          if (range.length !== 0) {
            return args.length > 1 && range.length > 1 ? `(${range})` : range;
          }
        }
        if (node.nodes) {
          for (const child of node.nodes) {
            output += walk(child, node);
          }
        }
        return output;
      };
      return walk(ast);
    };
    module.exports = compile;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/expand.js
var require_expand = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/expand.js"(exports, module) {
    "use strict";
    var fill = require_fill_range();
    var stringify = require_stringify();
    var utils = require_utils();
    var append = (queue = "", stash = "", enclose = false) => {
      const result = [];
      queue = [].concat(queue);
      stash = [].concat(stash);
      if (!stash.length) return queue;
      if (!queue.length) {
        return enclose ? utils.flatten(stash).map((ele) => `{${ele}}`) : stash;
      }
      for (const item of queue) {
        if (Array.isArray(item)) {
          for (const value of item) {
            result.push(append(value, stash, enclose));
          }
        } else {
          for (let ele of stash) {
            if (enclose === true && typeof ele === "string") ele = `{${ele}}`;
            result.push(Array.isArray(ele) ? append(item, ele, enclose) : item + ele);
          }
        }
      }
      return utils.flatten(result);
    };
    var expand = (ast, options = {}) => {
      const rangeLimit = options.rangeLimit === void 0 ? 1e3 : options.rangeLimit;
      const walk = (node, parent = {}) => {
        node.queue = [];
        let p = parent;
        let q = parent.queue;
        while (p.type !== "brace" && p.type !== "root" && p.parent) {
          p = p.parent;
          q = p.queue;
        }
        if (node.invalid || node.dollar) {
          q.push(append(q.pop(), stringify(node, options)));
          return;
        }
        if (node.type === "brace" && node.invalid !== true && node.nodes.length === 2) {
          q.push(append(q.pop(), ["{}"]));
          return;
        }
        if (node.nodes && node.ranges > 0) {
          const args = utils.reduce(node.nodes);
          if (utils.exceedsLimit(...args, options.step, rangeLimit)) {
            throw new RangeError("expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.");
          }
          let range = fill(...args, options);
          if (range.length === 0) {
            range = stringify(node, options);
          }
          q.push(append(q.pop(), range));
          node.nodes = [];
          return;
        }
        const enclose = utils.encloseBrace(node);
        let queue = node.queue;
        let block = node;
        while (block.type !== "brace" && block.type !== "root" && block.parent) {
          block = block.parent;
          queue = block.queue;
        }
        for (let i = 0; i < node.nodes.length; i++) {
          const child = node.nodes[i];
          if (child.type === "comma" && node.type === "brace") {
            if (i === 1) queue.push("");
            queue.push("");
            continue;
          }
          if (child.type === "close") {
            q.push(append(q.pop(), queue, enclose));
            continue;
          }
          if (child.value && child.type !== "open") {
            queue.push(append(queue.pop(), child.value));
            continue;
          }
          if (child.nodes) {
            walk(child, node);
          }
        }
        return queue;
      };
      return utils.flatten(walk(ast));
    };
    module.exports = expand;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/constants.js"(exports, module) {
    "use strict";
    module.exports = {
      MAX_LENGTH: 1e4,
      // Digits
      CHAR_0: "0",
      /* 0 */
      CHAR_9: "9",
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: "A",
      /* A */
      CHAR_LOWERCASE_A: "a",
      /* a */
      CHAR_UPPERCASE_Z: "Z",
      /* Z */
      CHAR_LOWERCASE_Z: "z",
      /* z */
      CHAR_LEFT_PARENTHESES: "(",
      /* ( */
      CHAR_RIGHT_PARENTHESES: ")",
      /* ) */
      CHAR_ASTERISK: "*",
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: "&",
      /* & */
      CHAR_AT: "@",
      /* @ */
      CHAR_BACKSLASH: "\\",
      /* \ */
      CHAR_BACKTICK: "`",
      /* ` */
      CHAR_CARRIAGE_RETURN: "\r",
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: "^",
      /* ^ */
      CHAR_COLON: ":",
      /* : */
      CHAR_COMMA: ",",
      /* , */
      CHAR_DOLLAR: "$",
      /* . */
      CHAR_DOT: ".",
      /* . */
      CHAR_DOUBLE_QUOTE: '"',
      /* " */
      CHAR_EQUAL: "=",
      /* = */
      CHAR_EXCLAMATION_MARK: "!",
      /* ! */
      CHAR_FORM_FEED: "\f",
      /* \f */
      CHAR_FORWARD_SLASH: "/",
      /* / */
      CHAR_HASH: "#",
      /* # */
      CHAR_HYPHEN_MINUS: "-",
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: "<",
      /* < */
      CHAR_LEFT_CURLY_BRACE: "{",
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: "[",
      /* [ */
      CHAR_LINE_FEED: "\n",
      /* \n */
      CHAR_NO_BREAK_SPACE: "\xA0",
      /* \u00A0 */
      CHAR_PERCENT: "%",
      /* % */
      CHAR_PLUS: "+",
      /* + */
      CHAR_QUESTION_MARK: "?",
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: ">",
      /* > */
      CHAR_RIGHT_CURLY_BRACE: "}",
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: "]",
      /* ] */
      CHAR_SEMICOLON: ";",
      /* ; */
      CHAR_SINGLE_QUOTE: "'",
      /* ' */
      CHAR_SPACE: " ",
      /*   */
      CHAR_TAB: "	",
      /* \t */
      CHAR_UNDERSCORE: "_",
      /* _ */
      CHAR_VERTICAL_LINE: "|",
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: "\uFEFF"
      /* \uFEFF */
    };
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/parse.js"(exports, module) {
    "use strict";
    var stringify = require_stringify();
    var {
      MAX_LENGTH,
      CHAR_BACKSLASH,
      /* \ */
      CHAR_BACKTICK,
      /* ` */
      CHAR_COMMA,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_LEFT_SQUARE_BRACKET,
      /* [ */
      CHAR_RIGHT_SQUARE_BRACKET,
      /* ] */
      CHAR_DOUBLE_QUOTE,
      /* " */
      CHAR_SINGLE_QUOTE,
      /* ' */
      CHAR_NO_BREAK_SPACE,
      CHAR_ZERO_WIDTH_NOBREAK_SPACE
    } = require_constants();
    var parse = (input, options = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      const opts = options || {};
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      if (input.length > max) {
        throw new SyntaxError(`Input length (${input.length}), exceeds max characters (${max})`);
      }
      const ast = { type: "root", input, nodes: [] };
      const stack = [ast];
      let block = ast;
      let prev = ast;
      let brackets = 0;
      const length = input.length;
      let index = 0;
      let depth = 0;
      let value;
      const advance = () => input[index++];
      const push = (node) => {
        if (node.type === "text" && prev.type === "dot") {
          prev.type = "text";
        }
        if (prev && prev.type === "text" && node.type === "text") {
          prev.value += node.value;
          return;
        }
        block.nodes.push(node);
        node.parent = block;
        node.prev = prev;
        prev = node;
        return node;
      };
      push({ type: "bos" });
      while (index < length) {
        block = stack[stack.length - 1];
        value = advance();
        if (value === CHAR_ZERO_WIDTH_NOBREAK_SPACE || value === CHAR_NO_BREAK_SPACE) {
          continue;
        }
        if (value === CHAR_BACKSLASH) {
          push({ type: "text", value: (options.keepEscaping ? value : "") + advance() });
          continue;
        }
        if (value === CHAR_RIGHT_SQUARE_BRACKET) {
          push({ type: "text", value: "\\" + value });
          continue;
        }
        if (value === CHAR_LEFT_SQUARE_BRACKET) {
          brackets++;
          let next;
          while (index < length && (next = advance())) {
            value += next;
            if (next === CHAR_LEFT_SQUARE_BRACKET) {
              brackets++;
              continue;
            }
            if (next === CHAR_BACKSLASH) {
              value += advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET) {
              brackets--;
              if (brackets === 0) {
                break;
              }
            }
          }
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_LEFT_PARENTHESES) {
          block = push({ type: "paren", nodes: [] });
          stack.push(block);
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_RIGHT_PARENTHESES) {
          if (block.type !== "paren") {
            push({ type: "text", value });
            continue;
          }
          block = stack.pop();
          push({ type: "text", value });
          block = stack[stack.length - 1];
          continue;
        }
        if (value === CHAR_DOUBLE_QUOTE || value === CHAR_SINGLE_QUOTE || value === CHAR_BACKTICK) {
          const open = value;
          let next;
          if (options.keepQuotes !== true) {
            value = "";
          }
          while (index < length && (next = advance())) {
            if (next === CHAR_BACKSLASH) {
              value += next + advance();
              continue;
            }
            if (next === open) {
              if (options.keepQuotes === true) value += next;
              break;
            }
            value += next;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_LEFT_CURLY_BRACE) {
          depth++;
          const dollar = prev.value && prev.value.slice(-1) === "$" || block.dollar === true;
          const brace = {
            type: "brace",
            open: true,
            close: false,
            dollar,
            depth,
            commas: 0,
            ranges: 0,
            nodes: []
          };
          block = push(brace);
          stack.push(block);
          push({ type: "open", value });
          continue;
        }
        if (value === CHAR_RIGHT_CURLY_BRACE) {
          if (block.type !== "brace") {
            push({ type: "text", value });
            continue;
          }
          const type = "close";
          block = stack.pop();
          block.close = true;
          push({ type, value });
          depth--;
          block = stack[stack.length - 1];
          continue;
        }
        if (value === CHAR_COMMA && depth > 0) {
          if (block.ranges > 0) {
            block.ranges = 0;
            const open = block.nodes.shift();
            block.nodes = [open, { type: "text", value: stringify(block) }];
          }
          push({ type: "comma", value });
          block.commas++;
          continue;
        }
        if (value === CHAR_DOT && depth > 0 && block.commas === 0) {
          const siblings = block.nodes;
          if (depth === 0 || siblings.length === 0) {
            push({ type: "text", value });
            continue;
          }
          if (prev.type === "dot") {
            block.range = [];
            prev.value += value;
            prev.type = "range";
            if (block.nodes.length !== 3 && block.nodes.length !== 5) {
              block.invalid = true;
              block.ranges = 0;
              prev.type = "text";
              continue;
            }
            block.ranges++;
            block.args = [];
            continue;
          }
          if (prev.type === "range") {
            siblings.pop();
            const before = siblings[siblings.length - 1];
            before.value += prev.value + value;
            prev = before;
            block.ranges--;
            continue;
          }
          push({ type: "dot", value });
          continue;
        }
        push({ type: "text", value });
      }
      do {
        block = stack.pop();
        if (block.type !== "root") {
          block.nodes.forEach((node) => {
            if (!node.nodes) {
              if (node.type === "open") node.isOpen = true;
              if (node.type === "close") node.isClose = true;
              if (!node.nodes) node.type = "text";
              node.invalid = true;
            }
          });
          const parent = stack[stack.length - 1];
          const index2 = parent.nodes.indexOf(block);
          parent.nodes.splice(index2, 1, ...block.nodes);
        }
      } while (stack.length > 0);
      push({ type: "eos" });
      return ast;
    };
    module.exports = parse;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/index.js
var require_braces = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/index.js"(exports, module) {
    "use strict";
    var stringify = require_stringify();
    var compile = require_compile();
    var expand = require_expand();
    var parse = require_parse();
    var braces = (input, options = {}) => {
      let output = [];
      if (Array.isArray(input)) {
        for (const pattern of input) {
          const result = braces.create(pattern, options);
          if (Array.isArray(result)) {
            output.push(...result);
          } else {
            output.push(result);
          }
        }
      } else {
        output = [].concat(braces.create(input, options));
      }
      if (options && options.expand === true && options.nodupes === true) {
        output = [...new Set(output)];
      }
      return output;
    };
    braces.parse = (input, options = {}) => parse(input, options);
    braces.stringify = (input, options = {}) => {
      if (typeof input === "string") {
        return stringify(braces.parse(input, options), options);
      }
      return stringify(input, options);
    };
    braces.compile = (input, options = {}) => {
      if (typeof input === "string") {
        input = braces.parse(input, options);
      }
      return compile(input, options);
    };
    braces.expand = (input, options = {}) => {
      if (typeof input === "string") {
        input = braces.parse(input, options);
      }
      let result = expand(input, options);
      if (options.noempty === true) {
        result = result.filter(Boolean);
      }
      if (options.nodupes === true) {
        result = [...new Set(result)];
      }
      return result;
    };
    braces.create = (input, options = {}) => {
      if (input === "" || input.length < 3) {
        return [input];
      }
      return options.expand !== true ? braces.compile(input, options) : braces.expand(input, options);
    };
    module.exports = braces;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/constants.js
var require_constants2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/constants.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var WIN_SLASH = "\\\\/";
    var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
    var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
    var DOT_LITERAL = "\\.";
    var PLUS_LITERAL = "\\+";
    var QMARK_LITERAL = "\\?";
    var SLASH_LITERAL = "\\/";
    var ONE_CHAR = "(?=.)";
    var QMARK = "[^/]";
    var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
    var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
    var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
    var NO_DOT = `(?!${DOT_LITERAL})`;
    var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
    var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
    var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
    var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
    var STAR = `${QMARK}*?`;
    var POSIX_CHARS = {
      DOT_LITERAL,
      PLUS_LITERAL,
      QMARK_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      QMARK,
      END_ANCHOR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR
    };
    var WINDOWS_CHARS = {
      ...POSIX_CHARS,
      SLASH_LITERAL: `[${WIN_SLASH}]`,
      QMARK: WIN_NO_SLASH,
      STAR: `${WIN_NO_SLASH}*?`,
      DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
      NO_DOT: `(?!${DOT_LITERAL})`,
      NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
      NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
      START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
      END_ANCHOR: `(?:[${WIN_SLASH}]|$)`
    };
    var POSIX_REGEX_SOURCE = {
      __proto__: null,
      alnum: "a-zA-Z0-9",
      alpha: "a-zA-Z",
      ascii: "\\x00-\\x7F",
      blank: " \\t",
      cntrl: "\\x00-\\x1F\\x7F",
      digit: "0-9",
      graph: "\\x21-\\x7E",
      lower: "a-z",
      print: "\\x20-\\x7E ",
      punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
      space: " \\t\\r\\n\\v\\f",
      upper: "A-Z",
      word: "A-Za-z0-9_",
      xdigit: "A-Fa-f0-9"
    };
    module.exports = {
      DEFAULT_MAX_EXTGLOB_RECURSION,
      MAX_LENGTH: 1024 * 64,
      POSIX_REGEX_SOURCE,
      // regular expressions
      REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
      REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
      REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
      REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
      REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
      REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
      // Replace globs with equivalent patterns to reduce parsing time.
      REPLACEMENTS: {
        __proto__: null,
        "***": "*",
        "**/**": "**",
        "**/**/**": "**"
      },
      // Digits
      CHAR_0: 48,
      /* 0 */
      CHAR_9: 57,
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: 65,
      /* A */
      CHAR_LOWERCASE_A: 97,
      /* a */
      CHAR_UPPERCASE_Z: 90,
      /* Z */
      CHAR_LOWERCASE_Z: 122,
      /* z */
      CHAR_LEFT_PARENTHESES: 40,
      /* ( */
      CHAR_RIGHT_PARENTHESES: 41,
      /* ) */
      CHAR_ASTERISK: 42,
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: 38,
      /* & */
      CHAR_AT: 64,
      /* @ */
      CHAR_BACKWARD_SLASH: 92,
      /* \ */
      CHAR_CARRIAGE_RETURN: 13,
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: 94,
      /* ^ */
      CHAR_COLON: 58,
      /* : */
      CHAR_COMMA: 44,
      /* , */
      CHAR_DOT: 46,
      /* . */
      CHAR_DOUBLE_QUOTE: 34,
      /* " */
      CHAR_EQUAL: 61,
      /* = */
      CHAR_EXCLAMATION_MARK: 33,
      /* ! */
      CHAR_FORM_FEED: 12,
      /* \f */
      CHAR_FORWARD_SLASH: 47,
      /* / */
      CHAR_GRAVE_ACCENT: 96,
      /* ` */
      CHAR_HASH: 35,
      /* # */
      CHAR_HYPHEN_MINUS: 45,
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: 60,
      /* < */
      CHAR_LEFT_CURLY_BRACE: 123,
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: 91,
      /* [ */
      CHAR_LINE_FEED: 10,
      /* \n */
      CHAR_NO_BREAK_SPACE: 160,
      /* \u00A0 */
      CHAR_PERCENT: 37,
      /* % */
      CHAR_PLUS: 43,
      /* + */
      CHAR_QUESTION_MARK: 63,
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: 62,
      /* > */
      CHAR_RIGHT_CURLY_BRACE: 125,
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: 93,
      /* ] */
      CHAR_SEMICOLON: 59,
      /* ; */
      CHAR_SINGLE_QUOTE: 39,
      /* ' */
      CHAR_SPACE: 32,
      /*   */
      CHAR_TAB: 9,
      /* \t */
      CHAR_UNDERSCORE: 95,
      /* _ */
      CHAR_VERTICAL_LINE: 124,
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
      /* \uFEFF */
      SEP: path.sep,
      /**
       * Create EXTGLOB_CHARS
       */
      extglobChars(chars) {
        return {
          "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
          "?": { type: "qmark", open: "(?:", close: ")?" },
          "+": { type: "plus", open: "(?:", close: ")+" },
          "*": { type: "star", open: "(?:", close: ")*" },
          "@": { type: "at", open: "(?:", close: ")" }
        };
      },
      /**
       * Create GLOB_CHARS
       */
      globChars(win32) {
        return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
      }
    };
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/utils.js
var require_utils2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/utils.js"(exports) {
    "use strict";
    var path = __require("path");
    var win32 = process.platform === "win32";
    var {
      REGEX_BACKSLASH,
      REGEX_REMOVE_BACKSLASH,
      REGEX_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_GLOBAL
    } = require_constants2();
    exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
    exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
    exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
    exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
    exports.removeBackslashes = (str) => {
      return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
        return match === "\\" ? "" : match;
      });
    };
    exports.supportsLookbehinds = () => {
      const segs = process.version.slice(1).split(".").map(Number);
      if (segs.length === 3 && segs[0] >= 9 || segs[0] === 8 && segs[1] >= 10) {
        return true;
      }
      return false;
    };
    exports.isWindows = (options) => {
      if (options && typeof options.windows === "boolean") {
        return options.windows;
      }
      return win32 === true || path.sep === "\\";
    };
    exports.escapeLast = (input, char, lastIdx) => {
      const idx = input.lastIndexOf(char, lastIdx);
      if (idx === -1) return input;
      if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
      return `${input.slice(0, idx)}\\${input.slice(idx)}`;
    };
    exports.removePrefix = (input, state = {}) => {
      let output = input;
      if (output.startsWith("./")) {
        output = output.slice(2);
        state.prefix = "./";
      }
      return output;
    };
    exports.wrapOutput = (input, state = {}, options = {}) => {
      const prepend = options.contains ? "" : "^";
      const append = options.contains ? "" : "$";
      let output = `${prepend}(?:${input})${append}`;
      if (state.negated === true) {
        output = `(?:^(?!${output}).*$)`;
      }
      return output;
    };
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/scan.js"(exports, module) {
    "use strict";
    var utils = require_utils2();
    var {
      CHAR_ASTERISK,
      /* * */
      CHAR_AT,
      /* @ */
      CHAR_BACKWARD_SLASH,
      /* \ */
      CHAR_COMMA,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_EXCLAMATION_MARK,
      /* ! */
      CHAR_FORWARD_SLASH,
      /* / */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_LEFT_SQUARE_BRACKET,
      /* [ */
      CHAR_PLUS,
      /* + */
      CHAR_QUESTION_MARK,
      /* ? */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_RIGHT_SQUARE_BRACKET
      /* ] */
    } = require_constants2();
    var isPathSeparator = (code) => {
      return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
    };
    var depth = (token) => {
      if (token.isPrefix !== true) {
        token.depth = token.isGlobstar ? Infinity : 1;
      }
    };
    var scan = (input, options) => {
      const opts = options || {};
      const length = input.length - 1;
      const scanToEnd = opts.parts === true || opts.scanToEnd === true;
      const slashes = [];
      const tokens = [];
      const parts = [];
      let str = input;
      let index = -1;
      let start = 0;
      let lastIndex = 0;
      let isBrace = false;
      let isBracket = false;
      let isGlob = false;
      let isExtglob = false;
      let isGlobstar = false;
      let braceEscaped = false;
      let backslashes = false;
      let negated = false;
      let negatedExtglob = false;
      let finished = false;
      let braces = 0;
      let prev;
      let code;
      let token = { value: "", depth: 0, isGlob: false };
      const eos = () => index >= length;
      const peek = () => str.charCodeAt(index + 1);
      const advance = () => {
        prev = code;
        return str.charCodeAt(++index);
      };
      while (index < length) {
        code = advance();
        let next;
        if (code === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          code = advance();
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braceEscaped = true;
          }
          continue;
        }
        if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
          braces++;
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (code === CHAR_LEFT_CURLY_BRACE) {
              braces++;
              continue;
            }
            if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (braceEscaped !== true && code === CHAR_COMMA) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (code === CHAR_RIGHT_CURLY_BRACE) {
              braces--;
              if (braces === 0) {
                braceEscaped = false;
                isBrace = token.isBrace = true;
                finished = true;
                break;
              }
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_FORWARD_SLASH) {
          slashes.push(index);
          tokens.push(token);
          token = { value: "", depth: 0, isGlob: false };
          if (finished === true) continue;
          if (prev === CHAR_DOT && index === start + 1) {
            start += 2;
            continue;
          }
          lastIndex = index + 1;
          continue;
        }
        if (opts.noext !== true) {
          const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
          if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
            isGlob = token.isGlob = true;
            isExtglob = token.isExtglob = true;
            finished = true;
            if (code === CHAR_EXCLAMATION_MARK && index === start) {
              negatedExtglob = true;
            }
            if (scanToEnd === true) {
              while (eos() !== true && (code = advance())) {
                if (code === CHAR_BACKWARD_SLASH) {
                  backslashes = token.backslashes = true;
                  code = advance();
                  continue;
                }
                if (code === CHAR_RIGHT_PARENTHESES) {
                  isGlob = token.isGlob = true;
                  finished = true;
                  break;
                }
              }
              continue;
            }
            break;
          }
        }
        if (code === CHAR_ASTERISK) {
          if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_QUESTION_MARK) {
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_LEFT_SQUARE_BRACKET) {
          while (eos() !== true && (next = advance())) {
            if (next === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET) {
              isBracket = token.isBracket = true;
              isGlob = token.isGlob = true;
              finished = true;
              break;
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
          negated = token.negated = true;
          start++;
          continue;
        }
        if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_LEFT_PARENTHESES) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES) {
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
        if (isGlob === true) {
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
      }
      if (opts.noext === true) {
        isExtglob = false;
        isGlob = false;
      }
      let base = str;
      let prefix = "";
      let glob = "";
      if (start > 0) {
        prefix = str.slice(0, start);
        str = str.slice(start);
        lastIndex -= start;
      }
      if (base && isGlob === true && lastIndex > 0) {
        base = str.slice(0, lastIndex);
        glob = str.slice(lastIndex);
      } else if (isGlob === true) {
        base = "";
        glob = str;
      } else {
        base = str;
      }
      if (base && base !== "" && base !== "/" && base !== str) {
        if (isPathSeparator(base.charCodeAt(base.length - 1))) {
          base = base.slice(0, -1);
        }
      }
      if (opts.unescape === true) {
        if (glob) glob = utils.removeBackslashes(glob);
        if (base && backslashes === true) {
          base = utils.removeBackslashes(base);
        }
      }
      const state = {
        prefix,
        input,
        start,
        base,
        glob,
        isBrace,
        isBracket,
        isGlob,
        isExtglob,
        isGlobstar,
        negated,
        negatedExtglob
      };
      if (opts.tokens === true) {
        state.maxDepth = 0;
        if (!isPathSeparator(code)) {
          tokens.push(token);
        }
        state.tokens = tokens;
      }
      if (opts.parts === true || opts.tokens === true) {
        let prevIndex;
        for (let idx = 0; idx < slashes.length; idx++) {
          const n = prevIndex ? prevIndex + 1 : start;
          const i = slashes[idx];
          const value = input.slice(n, i);
          if (opts.tokens) {
            if (idx === 0 && start !== 0) {
              tokens[idx].isPrefix = true;
              tokens[idx].value = prefix;
            } else {
              tokens[idx].value = value;
            }
            depth(tokens[idx]);
            state.maxDepth += tokens[idx].depth;
          }
          if (idx !== 0 || value !== "") {
            parts.push(value);
          }
          prevIndex = i;
        }
        if (prevIndex && prevIndex + 1 < input.length) {
          const value = input.slice(prevIndex + 1);
          parts.push(value);
          if (opts.tokens) {
            tokens[tokens.length - 1].value = value;
            depth(tokens[tokens.length - 1]);
            state.maxDepth += tokens[tokens.length - 1].depth;
          }
        }
        state.slashes = slashes;
        state.parts = parts;
      }
      return state;
    };
    module.exports = scan;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/parse.js
var require_parse2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/parse.js"(exports, module) {
    "use strict";
    var constants = require_constants2();
    var utils = require_utils2();
    var {
      MAX_LENGTH,
      POSIX_REGEX_SOURCE,
      REGEX_NON_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_BACKREF,
      REPLACEMENTS
    } = constants;
    var expandRange = (args, options) => {
      if (typeof options.expandRange === "function") {
        return options.expandRange(...args, options);
      }
      args.sort();
      const value = `[${args.join("-")}]`;
      try {
        new RegExp(value);
      } catch (ex) {
        return args.map((v) => utils.escapeRegex(v)).join("..");
      }
      return value;
    };
    var syntaxError = (type, char) => {
      return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
    };
    var splitTopLevel = (input) => {
      const parts = [];
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let value = "";
      let escaped = false;
      for (const ch of input) {
        if (escaped === true) {
          value += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          value += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          value += ch;
          continue;
        }
        if (quote === 0) {
          if (ch === "[") {
            bracket++;
          } else if (ch === "]" && bracket > 0) {
            bracket--;
          } else if (bracket === 0) {
            if (ch === "(") {
              paren++;
            } else if (ch === ")" && paren > 0) {
              paren--;
            } else if (ch === "|" && paren === 0) {
              parts.push(value);
              value = "";
              continue;
            }
          }
        }
        value += ch;
      }
      parts.push(value);
      return parts;
    };
    var isPlainBranch = (branch) => {
      let escaped = false;
      for (const ch of branch) {
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (/[?*+@!()[\]{}]/.test(ch)) {
          return false;
        }
      }
      return true;
    };
    var normalizeSimpleBranch = (branch) => {
      let value = branch.trim();
      let changed = true;
      while (changed === true) {
        changed = false;
        if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
          value = value.slice(2, -1);
          changed = true;
        }
      }
      if (!isPlainBranch(value)) {
        return;
      }
      return value.replace(/\\(.)/g, "$1");
    };
    var hasRepeatedCharPrefixOverlap = (branches) => {
      const values = branches.map(normalizeSimpleBranch).filter(Boolean);
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i];
          const b = values[j];
          const char = a[0];
          if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
            continue;
          }
          if (a === b || a.startsWith(b) || b.startsWith(a)) {
            return true;
          }
        }
      }
      return false;
    };
    var parseRepeatedExtglob = (pattern, requireEnd = true) => {
      if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
        return;
      }
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let escaped = false;
      for (let i = 1; i < pattern.length; i++) {
        const ch = pattern[i];
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          continue;
        }
        if (quote === 1) {
          continue;
        }
        if (ch === "[") {
          bracket++;
          continue;
        }
        if (ch === "]" && bracket > 0) {
          bracket--;
          continue;
        }
        if (bracket > 0) {
          continue;
        }
        if (ch === "(") {
          paren++;
          continue;
        }
        if (ch === ")") {
          paren--;
          if (paren === 0) {
            if (requireEnd === true && i !== pattern.length - 1) {
              return;
            }
            return {
              type: pattern[0],
              body: pattern.slice(2, i),
              end: i
            };
          }
        }
      }
    };
    var getStarExtglobSequenceOutput = (pattern) => {
      let index = 0;
      const chars = [];
      while (index < pattern.length) {
        const match = parseRepeatedExtglob(pattern.slice(index), false);
        if (!match || match.type !== "*") {
          return;
        }
        const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
        if (branches.length !== 1) {
          return;
        }
        const branch = normalizeSimpleBranch(branches[0]);
        if (!branch || branch.length !== 1) {
          return;
        }
        chars.push(branch);
        index += match.end + 1;
      }
      if (chars.length < 1) {
        return;
      }
      const source = chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`;
      return `${source}*`;
    };
    var repeatedExtglobRecursion = (pattern) => {
      let depth = 0;
      let value = pattern.trim();
      let match = parseRepeatedExtglob(value);
      while (match) {
        depth++;
        value = match.body.trim();
        match = parseRepeatedExtglob(value);
      }
      return depth;
    };
    var analyzeRepeatedExtglob = (body, options) => {
      if (options.maxExtglobRecursion === false) {
        return { risky: false };
      }
      const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
      const branches = splitTopLevel(body).map((branch) => branch.trim());
      if (branches.length > 1) {
        if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
          return { risky: true };
        }
      }
      for (const branch of branches) {
        const safeOutput = getStarExtglobSequenceOutput(branch);
        if (safeOutput) {
          return { risky: true, safeOutput };
        }
        if (repeatedExtglobRecursion(branch) > max) {
          return { risky: true };
        }
      }
      return { risky: false };
    };
    var parse = (input, options) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      input = REPLACEMENTS[input] || input;
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      let len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      const bos = { type: "bos", value: "", output: opts.prepend || "" };
      const tokens = [bos];
      const capture = opts.capture ? "" : "?:";
      const win32 = utils.isWindows(options);
      const PLATFORM_CHARS = constants.globChars(win32);
      const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
      const {
        DOT_LITERAL,
        PLUS_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOT_SLASH,
        NO_DOTS_SLASH,
        QMARK,
        QMARK_NO_DOT,
        STAR,
        START_ANCHOR
      } = PLATFORM_CHARS;
      const globstar = (opts2) => {
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const nodot = opts.dot ? "" : NO_DOT;
      const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
      let star = opts.bash === true ? globstar(opts) : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      if (typeof opts.noext === "boolean") {
        opts.noextglob = opts.noext;
      }
      const state = {
        input,
        index: -1,
        start: 0,
        dot: opts.dot === true,
        consumed: "",
        output: "",
        prefix: "",
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        quotes: 0,
        globstar: false,
        tokens
      };
      input = utils.removePrefix(input, state);
      len = input.length;
      const extglobs = [];
      const braces = [];
      const stack = [];
      let prev = bos;
      let value;
      const eos = () => state.index === len - 1;
      const peek = state.peek = (n = 1) => input[state.index + n];
      const advance = state.advance = () => input[++state.index] || "";
      const remaining = () => input.slice(state.index + 1);
      const consume = (value2 = "", num = 0) => {
        state.consumed += value2;
        state.index += num;
      };
      const append = (token) => {
        state.output += token.output != null ? token.output : token.value;
        consume(token.value);
      };
      const negate = () => {
        let count = 1;
        while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
          advance();
          state.start++;
          count++;
        }
        if (count % 2 === 0) {
          return false;
        }
        state.negated = true;
        state.start++;
        return true;
      };
      const increment = (type) => {
        state[type]++;
        stack.push(type);
      };
      const decrement = (type) => {
        state[type]--;
        stack.pop();
      };
      const push = (tok) => {
        if (prev.type === "globstar") {
          const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
          const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
          if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
            state.output = state.output.slice(0, -prev.output.length);
            prev.type = "star";
            prev.value = "*";
            prev.output = star;
            state.output += prev.output;
          }
        }
        if (extglobs.length && tok.type !== "paren") {
          extglobs[extglobs.length - 1].inner += tok.value;
        }
        if (tok.value || tok.output) append(tok);
        if (prev && prev.type === "text" && tok.type === "text") {
          prev.value += tok.value;
          prev.output = (prev.output || "") + tok.value;
          return;
        }
        tok.prev = prev;
        tokens.push(tok);
        prev = tok;
      };
      const extglobOpen = (type, value2) => {
        const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
        token.prev = prev;
        token.parens = state.parens;
        token.output = state.output;
        token.startIndex = state.index;
        token.tokensIndex = tokens.length;
        const output = (opts.capture ? "(" : "") + token.open;
        increment("parens");
        push({ type, value: value2, output: state.output ? "" : ONE_CHAR });
        push({ type: "paren", extglob: true, value: advance(), output });
        extglobs.push(token);
      };
      const extglobClose = (token) => {
        const literal = input.slice(token.startIndex, state.index + 1);
        const body = input.slice(token.startIndex + 2, state.index);
        const analysis = analyzeRepeatedExtglob(body, opts);
        if ((token.type === "plus" || token.type === "star") && analysis.risky) {
          const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
          const open = tokens[token.tokensIndex];
          open.type = "text";
          open.value = literal;
          open.output = safeOutput || utils.escapeRegex(literal);
          for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
            tokens[i].value = "";
            tokens[i].output = "";
            delete tokens[i].suffix;
          }
          state.output = token.output + open.output;
          state.backtrack = true;
          push({ type: "paren", extglob: true, value, output: "" });
          decrement("parens");
          return;
        }
        let output = token.close + (opts.capture ? ")" : "");
        let rest;
        if (token.type === "negate") {
          let extglobStar = star;
          if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
            extglobStar = globstar(opts);
          }
          if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
            output = token.close = `)$))${extglobStar}`;
          }
          if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
            const expression = parse(rest, { ...options, fastpaths: false }).output;
            output = token.close = `)${expression})${extglobStar})`;
          }
          if (token.prev.type === "bos") {
            state.negatedExtglob = true;
          }
        }
        push({ type: "paren", extglob: true, value, output });
        decrement("parens");
      };
      if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
        let backslashes = false;
        let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
          if (first === "\\") {
            backslashes = true;
            return m;
          }
          if (first === "?") {
            if (esc) {
              return esc + first + (rest ? QMARK.repeat(rest.length) : "");
            }
            if (index === 0) {
              return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
            }
            return QMARK.repeat(chars.length);
          }
          if (first === ".") {
            return DOT_LITERAL.repeat(chars.length);
          }
          if (first === "*") {
            if (esc) {
              return esc + first + (rest ? star : "");
            }
            return star;
          }
          return esc ? m : `\\${m}`;
        });
        if (backslashes === true) {
          if (opts.unescape === true) {
            output = output.replace(/\\/g, "");
          } else {
            output = output.replace(/\\+/g, (m) => {
              return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
            });
          }
        }
        if (output === input && opts.contains === true) {
          state.output = input;
          return state;
        }
        state.output = utils.wrapOutput(output, state, options);
        return state;
      }
      while (!eos()) {
        value = advance();
        if (value === "\0") {
          continue;
        }
        if (value === "\\") {
          const next = peek();
          if (next === "/" && opts.bash !== true) {
            continue;
          }
          if (next === "." || next === ";") {
            continue;
          }
          if (!next) {
            value += "\\";
            push({ type: "text", value });
            continue;
          }
          const match = /^\\+/.exec(remaining());
          let slashes = 0;
          if (match && match[0].length > 2) {
            slashes = match[0].length;
            state.index += slashes;
            if (slashes % 2 !== 0) {
              value += "\\";
            }
          }
          if (opts.unescape === true) {
            value = advance();
          } else {
            value += advance();
          }
          if (state.brackets === 0) {
            push({ type: "text", value });
            continue;
          }
        }
        if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
          if (opts.posix !== false && value === ":") {
            const inner = prev.value.slice(1);
            if (inner.includes("[")) {
              prev.posix = true;
              if (inner.includes(":")) {
                const idx = prev.value.lastIndexOf("[");
                const pre = prev.value.slice(0, idx);
                const rest2 = prev.value.slice(idx + 2);
                const posix = POSIX_REGEX_SOURCE[rest2];
                if (posix) {
                  prev.value = pre + posix;
                  state.backtrack = true;
                  advance();
                  if (!bos.output && tokens.indexOf(prev) === 1) {
                    bos.output = ONE_CHAR;
                  }
                  continue;
                }
              }
            }
          }
          if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
            value = `\\${value}`;
          }
          if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
            value = `\\${value}`;
          }
          if (opts.posix === true && value === "!" && prev.value === "[") {
            value = "^";
          }
          prev.value += value;
          append({ value });
          continue;
        }
        if (state.quotes === 1 && value !== '"') {
          value = utils.escapeRegex(value);
          prev.value += value;
          append({ value });
          continue;
        }
        if (value === '"') {
          state.quotes = state.quotes === 1 ? 0 : 1;
          if (opts.keepQuotes === true) {
            push({ type: "text", value });
          }
          continue;
        }
        if (value === "(") {
          increment("parens");
          push({ type: "paren", value });
          continue;
        }
        if (value === ")") {
          if (state.parens === 0 && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "("));
          }
          const extglob = extglobs[extglobs.length - 1];
          if (extglob && state.parens === extglob.parens + 1) {
            extglobClose(extglobs.pop());
            continue;
          }
          push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
          decrement("parens");
          continue;
        }
        if (value === "[") {
          if (opts.nobracket === true || !remaining().includes("]")) {
            if (opts.nobracket !== true && opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("closing", "]"));
            }
            value = `\\${value}`;
          } else {
            increment("brackets");
          }
          push({ type: "bracket", value });
          continue;
        }
        if (value === "]") {
          if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          if (state.brackets === 0) {
            if (opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("opening", "["));
            }
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          decrement("brackets");
          const prevValue = prev.value.slice(1);
          if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
            value = `/${value}`;
          }
          prev.value += value;
          append({ value });
          if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
            continue;
          }
          const escaped = utils.escapeRegex(prev.value);
          state.output = state.output.slice(0, -prev.value.length);
          if (opts.literalBrackets === true) {
            state.output += escaped;
            prev.value = escaped;
            continue;
          }
          prev.value = `(${capture}${escaped}|${prev.value})`;
          state.output += prev.value;
          continue;
        }
        if (value === "{" && opts.nobrace !== true) {
          increment("braces");
          const open = {
            type: "brace",
            value,
            output: "(",
            outputIndex: state.output.length,
            tokensIndex: state.tokens.length
          };
          braces.push(open);
          push(open);
          continue;
        }
        if (value === "}") {
          const brace = braces[braces.length - 1];
          if (opts.nobrace === true || !brace) {
            push({ type: "text", value, output: value });
            continue;
          }
          let output = ")";
          if (brace.dots === true) {
            const arr = tokens.slice();
            const range = [];
            for (let i = arr.length - 1; i >= 0; i--) {
              tokens.pop();
              if (arr[i].type === "brace") {
                break;
              }
              if (arr[i].type !== "dots") {
                range.unshift(arr[i].value);
              }
            }
            output = expandRange(range, opts);
            state.backtrack = true;
          }
          if (brace.comma !== true && brace.dots !== true) {
            const out = state.output.slice(0, brace.outputIndex);
            const toks = state.tokens.slice(brace.tokensIndex);
            brace.value = brace.output = "\\{";
            value = output = "\\}";
            state.output = out;
            for (const t of toks) {
              state.output += t.output || t.value;
            }
          }
          push({ type: "brace", value, output });
          decrement("braces");
          braces.pop();
          continue;
        }
        if (value === "|") {
          if (extglobs.length > 0) {
            extglobs[extglobs.length - 1].conditions++;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === ",") {
          let output = value;
          const brace = braces[braces.length - 1];
          if (brace && stack[stack.length - 1] === "braces") {
            brace.comma = true;
            output = "|";
          }
          push({ type: "comma", value, output });
          continue;
        }
        if (value === "/") {
          if (prev.type === "dot" && state.index === state.start + 1) {
            state.start = state.index + 1;
            state.consumed = "";
            state.output = "";
            tokens.pop();
            prev = bos;
            continue;
          }
          push({ type: "slash", value, output: SLASH_LITERAL });
          continue;
        }
        if (value === ".") {
          if (state.braces > 0 && prev.type === "dot") {
            if (prev.value === ".") prev.output = DOT_LITERAL;
            const brace = braces[braces.length - 1];
            prev.type = "dots";
            prev.output += value;
            prev.value += value;
            brace.dots = true;
            continue;
          }
          if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
            push({ type: "text", value, output: DOT_LITERAL });
            continue;
          }
          push({ type: "dot", value, output: DOT_LITERAL });
          continue;
        }
        if (value === "?") {
          const isGroup = prev && prev.value === "(";
          if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("qmark", value);
            continue;
          }
          if (prev && prev.type === "paren") {
            const next = peek();
            let output = value;
            if (next === "<" && !utils.supportsLookbehinds()) {
              throw new Error("Node.js v10 or higher is required for regex lookbehinds");
            }
            if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
              output = `\\${value}`;
            }
            push({ type: "text", value, output });
            continue;
          }
          if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
            push({ type: "qmark", value, output: QMARK_NO_DOT });
            continue;
          }
          push({ type: "qmark", value, output: QMARK });
          continue;
        }
        if (value === "!") {
          if (opts.noextglob !== true && peek() === "(") {
            if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
              extglobOpen("negate", value);
              continue;
            }
          }
          if (opts.nonegate !== true && state.index === 0) {
            negate();
            continue;
          }
        }
        if (value === "+") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("plus", value);
            continue;
          }
          if (prev && prev.value === "(" || opts.regex === false) {
            push({ type: "plus", value, output: PLUS_LITERAL });
            continue;
          }
          if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
            push({ type: "plus", value });
            continue;
          }
          push({ type: "plus", value: PLUS_LITERAL });
          continue;
        }
        if (value === "@") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            push({ type: "at", extglob: true, value, output: "" });
            continue;
          }
          push({ type: "text", value });
          continue;
        }
        if (value !== "*") {
          if (value === "$" || value === "^") {
            value = `\\${value}`;
          }
          const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
          if (match) {
            value += match[0];
            state.index += match[0].length;
          }
          push({ type: "text", value });
          continue;
        }
        if (prev && (prev.type === "globstar" || prev.star === true)) {
          prev.type = "star";
          prev.star = true;
          prev.value += value;
          prev.output = star;
          state.backtrack = true;
          state.globstar = true;
          consume(value);
          continue;
        }
        let rest = remaining();
        if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
          extglobOpen("star", value);
          continue;
        }
        if (prev.type === "star") {
          if (opts.noglobstar === true) {
            consume(value);
            continue;
          }
          const prior = prev.prev;
          const before = prior.prev;
          const isStart = prior.type === "slash" || prior.type === "bos";
          const afterStar = before && (before.type === "star" || before.type === "globstar");
          if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
            push({ type: "star", value, output: "" });
            continue;
          }
          const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
          const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
          if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
            push({ type: "star", value, output: "" });
            continue;
          }
          while (rest.slice(0, 3) === "/**") {
            const after = input[state.index + 4];
            if (after && after !== "/") {
              break;
            }
            rest = rest.slice(3);
            consume("/**", 3);
          }
          if (prior.type === "bos" && eos()) {
            prev.type = "globstar";
            prev.value += value;
            prev.output = globstar(opts);
            state.output = prev.output;
            state.globstar = true;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
            prev.value += value;
            state.globstar = true;
            state.output += prior.output + prev.output;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
            const end = rest[1] !== void 0 ? "|$" : "";
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
            prev.value += value;
            state.output += prior.output + prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          if (prior.type === "bos" && rest[0] === "/") {
            prev.type = "globstar";
            prev.value += value;
            prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
            state.output = prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "globstar";
          prev.output = globstar(opts);
          prev.value += value;
          state.output += prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        const token = { type: "star", value, output: star };
        if (opts.bash === true) {
          token.output = ".*?";
          if (prev.type === "bos" || prev.type === "slash") {
            token.output = nodot + token.output;
          }
          push(token);
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
          token.output = value;
          push(token);
          continue;
        }
        if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
          if (prev.type === "dot") {
            state.output += NO_DOT_SLASH;
            prev.output += NO_DOT_SLASH;
          } else if (opts.dot === true) {
            state.output += NO_DOTS_SLASH;
            prev.output += NO_DOTS_SLASH;
          } else {
            state.output += nodot;
            prev.output += nodot;
          }
          if (peek() !== "*") {
            state.output += ONE_CHAR;
            prev.output += ONE_CHAR;
          }
        }
        push(token);
      }
      while (state.brackets > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
        state.output = utils.escapeLast(state.output, "[");
        decrement("brackets");
      }
      while (state.parens > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
        state.output = utils.escapeLast(state.output, "(");
        decrement("parens");
      }
      while (state.braces > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
        state.output = utils.escapeLast(state.output, "{");
        decrement("braces");
      }
      if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
        push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
      }
      if (state.backtrack === true) {
        state.output = "";
        for (const token of state.tokens) {
          state.output += token.output != null ? token.output : token.value;
          if (token.suffix) {
            state.output += token.suffix;
          }
        }
      }
      return state;
    };
    parse.fastpaths = (input, options) => {
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      const len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      input = REPLACEMENTS[input] || input;
      const win32 = utils.isWindows(options);
      const {
        DOT_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOTS,
        NO_DOTS_SLASH,
        STAR,
        START_ANCHOR
      } = constants.globChars(win32);
      const nodot = opts.dot ? NO_DOTS : NO_DOT;
      const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
      const capture = opts.capture ? "" : "?:";
      const state = { negated: false, prefix: "" };
      let star = opts.bash === true ? ".*?" : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      const globstar = (opts2) => {
        if (opts2.noglobstar === true) return star;
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const create = (str) => {
        switch (str) {
          case "*":
            return `${nodot}${ONE_CHAR}${star}`;
          case ".*":
            return `${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*.*":
            return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*/*":
            return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
          case "**":
            return nodot + globstar(opts);
          case "**/*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
          case "**/*.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "**/.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
          default: {
            const match = /^(.*?)\.(\w+)$/.exec(str);
            if (!match) return;
            const source2 = create(match[1]);
            if (!source2) return;
            return source2 + DOT_LITERAL + match[2];
          }
        }
      };
      const output = utils.removePrefix(input, state);
      let source = create(output);
      if (source && opts.strictSlashes !== true) {
        source += `${SLASH_LITERAL}?`;
      }
      return source;
    };
    module.exports = parse;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/picomatch.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var scan = require_scan();
    var parse = require_parse2();
    var utils = require_utils2();
    var constants = require_constants2();
    var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
    var picomatch = (glob, options, returnState = false) => {
      if (Array.isArray(glob)) {
        const fns = glob.map((input) => picomatch(input, options, returnState));
        const arrayMatcher = (str) => {
          for (const isMatch of fns) {
            const state2 = isMatch(str);
            if (state2) return state2;
          }
          return false;
        };
        return arrayMatcher;
      }
      const isState = isObject(glob) && glob.tokens && glob.input;
      if (glob === "" || typeof glob !== "string" && !isState) {
        throw new TypeError("Expected pattern to be a non-empty string");
      }
      const opts = options || {};
      const posix = utils.isWindows(options);
      const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
      const state = regex.state;
      delete regex.state;
      let isIgnored = () => false;
      if (opts.ignore) {
        const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
        isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
      }
      const matcher = (input, returnObject = false) => {
        const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
        const result = { glob, state, regex, posix, input, output, match, isMatch };
        if (typeof opts.onResult === "function") {
          opts.onResult(result);
        }
        if (isMatch === false) {
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (isIgnored(input)) {
          if (typeof opts.onIgnore === "function") {
            opts.onIgnore(result);
          }
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (typeof opts.onMatch === "function") {
          opts.onMatch(result);
        }
        return returnObject ? result : true;
      };
      if (returnState) {
        matcher.state = state;
      }
      return matcher;
    };
    picomatch.test = (input, regex, options, { glob, posix } = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected input to be a string");
      }
      if (input === "") {
        return { isMatch: false, output: "" };
      }
      const opts = options || {};
      const format = opts.format || (posix ? utils.toPosixSlashes : null);
      let match = input === glob;
      let output = match && format ? format(input) : input;
      if (match === false) {
        output = format ? format(input) : input;
        match = output === glob;
      }
      if (match === false || opts.capture === true) {
        if (opts.matchBase === true || opts.basename === true) {
          match = picomatch.matchBase(input, regex, options, posix);
        } else {
          match = regex.exec(output);
        }
      }
      return { isMatch: Boolean(match), match, output };
    };
    picomatch.matchBase = (input, glob, options, posix = utils.isWindows(options)) => {
      const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
      return regex.test(path.basename(input));
    };
    picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
    picomatch.parse = (pattern, options) => {
      if (Array.isArray(pattern)) return pattern.map((p) => picomatch.parse(p, options));
      return parse(pattern, { ...options, fastpaths: false });
    };
    picomatch.scan = (input, options) => scan(input, options);
    picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
      if (returnOutput === true) {
        return state.output;
      }
      const opts = options || {};
      const prepend = opts.contains ? "" : "^";
      const append = opts.contains ? "" : "$";
      let source = `${prepend}(?:${state.output})${append}`;
      if (state && state.negated === true) {
        source = `^(?!${source}).*$`;
      }
      const regex = picomatch.toRegex(source, options);
      if (returnState === true) {
        regex.state = state;
      }
      return regex;
    };
    picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
      if (!input || typeof input !== "string") {
        throw new TypeError("Expected a non-empty string");
      }
      let parsed = { negated: false, fastpaths: true };
      if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
        parsed.output = parse.fastpaths(input, options);
      }
      if (!parsed.output) {
        parsed = parse(input, options);
      }
      return picomatch.compileRe(parsed, options, returnOutput, returnState);
    };
    picomatch.toRegex = (source, options) => {
      try {
        const opts = options || {};
        return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
      } catch (err) {
        if (options && options.debug === true) throw err;
        return /$^/;
      }
    };
    picomatch.constants = constants;
    module.exports = picomatch;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/index.js"(exports, module) {
    "use strict";
    module.exports = require_picomatch();
  }
});

// node_modules/.pnpm/micromatch@4.0.8/node_modules/micromatch/index.js
var require_micromatch = __commonJS({
  "node_modules/.pnpm/micromatch@4.0.8/node_modules/micromatch/index.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var braces = require_braces();
    var picomatch = require_picomatch2();
    var utils = require_utils2();
    var isEmptyString = (v) => v === "" || v === "./";
    var hasBraces = (v) => {
      const index = v.indexOf("{");
      return index > -1 && v.indexOf("}", index) > -1;
    };
    var micromatch2 = (list, patterns, options) => {
      patterns = [].concat(patterns);
      list = [].concat(list);
      let omit = /* @__PURE__ */ new Set();
      let keep = /* @__PURE__ */ new Set();
      let items = /* @__PURE__ */ new Set();
      let negatives = 0;
      let onResult = (state) => {
        items.add(state.output);
        if (options && options.onResult) {
          options.onResult(state);
        }
      };
      for (let i = 0; i < patterns.length; i++) {
        let isMatch = picomatch(String(patterns[i]), { ...options, onResult }, true);
        let negated = isMatch.state.negated || isMatch.state.negatedExtglob;
        if (negated) negatives++;
        for (let item of list) {
          let matched = isMatch(item, true);
          let match = negated ? !matched.isMatch : matched.isMatch;
          if (!match) continue;
          if (negated) {
            omit.add(matched.output);
          } else {
            omit.delete(matched.output);
            keep.add(matched.output);
          }
        }
      }
      let result = negatives === patterns.length ? [...items] : [...keep];
      let matches = result.filter((item) => !omit.has(item));
      if (options && matches.length === 0) {
        if (options.failglob === true) {
          throw new Error(`No matches found for "${patterns.join(", ")}"`);
        }
        if (options.nonull === true || options.nullglob === true) {
          return options.unescape ? patterns.map((p) => p.replace(/\\/g, "")) : patterns;
        }
      }
      return matches;
    };
    micromatch2.match = micromatch2;
    micromatch2.matcher = (pattern, options) => picomatch(pattern, options);
    micromatch2.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
    micromatch2.any = micromatch2.isMatch;
    micromatch2.not = (list, patterns, options = {}) => {
      patterns = [].concat(patterns).map(String);
      let result = /* @__PURE__ */ new Set();
      let items = [];
      let onResult = (state) => {
        if (options.onResult) options.onResult(state);
        items.push(state.output);
      };
      let matches = new Set(micromatch2(list, patterns, { ...options, onResult }));
      for (let item of items) {
        if (!matches.has(item)) {
          result.add(item);
        }
      }
      return [...result];
    };
    micromatch2.contains = (str, pattern, options) => {
      if (typeof str !== "string") {
        throw new TypeError(`Expected a string: "${util.inspect(str)}"`);
      }
      if (Array.isArray(pattern)) {
        return pattern.some((p) => micromatch2.contains(str, p, options));
      }
      if (typeof pattern === "string") {
        if (isEmptyString(str) || isEmptyString(pattern)) {
          return false;
        }
        if (str.includes(pattern) || str.startsWith("./") && str.slice(2).includes(pattern)) {
          return true;
        }
      }
      return micromatch2.isMatch(str, pattern, { ...options, contains: true });
    };
    micromatch2.matchKeys = (obj, patterns, options) => {
      if (!utils.isObject(obj)) {
        throw new TypeError("Expected the first argument to be an object");
      }
      let keys = micromatch2(Object.keys(obj), patterns, options);
      let res = {};
      for (let key of keys) res[key] = obj[key];
      return res;
    };
    micromatch2.some = (list, patterns, options) => {
      let items = [].concat(list);
      for (let pattern of [].concat(patterns)) {
        let isMatch = picomatch(String(pattern), options);
        if (items.some((item) => isMatch(item))) {
          return true;
        }
      }
      return false;
    };
    micromatch2.every = (list, patterns, options) => {
      let items = [].concat(list);
      for (let pattern of [].concat(patterns)) {
        let isMatch = picomatch(String(pattern), options);
        if (!items.every((item) => isMatch(item))) {
          return false;
        }
      }
      return true;
    };
    micromatch2.all = (str, patterns, options) => {
      if (typeof str !== "string") {
        throw new TypeError(`Expected a string: "${util.inspect(str)}"`);
      }
      return [].concat(patterns).every((p) => picomatch(p, options)(str));
    };
    micromatch2.capture = (glob, input, options) => {
      let posix = utils.isWindows(options);
      let regex = picomatch.makeRe(String(glob), { ...options, capture: true });
      let match = regex.exec(posix ? utils.toPosixSlashes(input) : input);
      if (match) {
        return match.slice(1).map((v) => v === void 0 ? "" : v);
      }
    };
    micromatch2.makeRe = (...args) => picomatch.makeRe(...args);
    micromatch2.scan = (...args) => picomatch.scan(...args);
    micromatch2.parse = (patterns, options) => {
      let res = [];
      for (let pattern of [].concat(patterns || [])) {
        for (let str of braces(String(pattern), options)) {
          res.push(picomatch.parse(str, options));
        }
      }
      return res;
    };
    micromatch2.braces = (pattern, options) => {
      if (typeof pattern !== "string") throw new TypeError("Expected a string");
      if (options && options.nobrace === true || !hasBraces(pattern)) {
        return [pattern];
      }
      return braces(pattern, options);
    };
    micromatch2.braceExpand = (pattern, options) => {
      if (typeof pattern !== "string") throw new TypeError("Expected a string");
      return micromatch2.braces(pattern, { ...options, expand: true });
    };
    micromatch2.hasBraces = hasBraces;
    module.exports = micromatch2;
  }
});

// src/plugins/artifact-generators/react-component-structure/cli/command.ts
import { mkdir as mkdir2, mkdtemp as mkdtemp2, writeFile } from "fs/promises";
import { tmpdir as tmpdir2 } from "os";
import { dirname as dirname2, join as join3 } from "path";

// src/plugins/artifact-generators/react-component-structure/analysis/build-component-graph.ts
var import_ignore2 = __toESM(require_ignore(), 1);
var import_micromatch = __toESM(require_micromatch(), 1);
import { createHash as createHash2 } from "crypto";
import { lstat as lstat2, realpath as realpath2 } from "fs/promises";
import { basename, extname as extname2, relative as relative3, resolve as resolve3 } from "path";

// src/features/diagram/diagram-route-requirement-rules.ts
function unionRulesets(...sets) {
  const rules = /* @__PURE__ */ new Map();
  let tautology = false;
  for (const rule of sets.flat()) {
    if (rule.length === 0) tautology = true;
    rules.set(JSON.stringify(rule), rule);
  }
  return tautology ? [[]] : [...rules.values()];
}
function combineRulesets(left, right) {
  return unionRulesets(
    left.flatMap(
      (prefix) => right.flatMap((suffix) => {
        const rule = [...prefix];
        for (const requirement of suffix) {
          const existing = rule.find(({ controlId }) => controlId === requirement.controlId);
          if (existing && existing.value !== requirement.value) return [];
          if (!existing) rule.push(requirement);
        }
        return [rule];
      })
    )
  );
}

// src/shared/node/path.ts
import { isAbsolute, relative, sep } from "path";
function toPosixPath(path) {
  return path.split(sep).join("/");
}
function isPathInside(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}
function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// src/plugins/artifact-generators/react-component-structure/analysis/collect-source-files.ts
var import_ignore = __toESM(require_ignore(), 1);
import { readdir, readFile, realpath, stat } from "fs/promises";
import { dirname, extname, isAbsolute as isAbsolute2, join, relative as relative2, resolve } from "path";
var sourceExtensions = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs"]);
var alwaysIgnoredDirectoryNames = /* @__PURE__ */ new Set([".git", "node_modules"]);
async function readIgnoreFileContents(ignoreFilePath) {
  let contents;
  try {
    contents = await readFile(ignoreFilePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return void 0;
    throw error;
  }
  return contents;
}
function addIgnoreRules(rules, contents) {
  return contents === void 0 ? rules : (0, import_ignore.default)().add(rules).add(contents);
}
async function collectInheritedIgnoreRules(scopePath, directoryPath) {
  let rules = (0, import_ignore.default)();
  const directoryRelativePath = relative2(scopePath, directoryPath);
  let currentPath = scopePath;
  for (const segment of ["", ...directoryRelativePath ? directoryRelativePath.split(/[\\/]/) : []]) {
    if (segment) currentPath = join(currentPath, segment);
    rules = addIgnoreRules(rules, await readIgnoreFileContents(join(currentPath, ".gitignore")));
  }
  return rules;
}
function isPathIgnored(rules, relativePath, isDirectory) {
  return rules.ignores(relativePath) || isDirectory && rules.ignores(`${relativePath}/`);
}
async function collectSourceFiles(scopePath, sourcePaths) {
  const files = /* @__PURE__ */ new Set();
  async function visitFile(resolvedPath) {
    if (!sourceExtensions.has(extname(resolvedPath))) return;
    files.add(resolvedPath);
  }
  async function visitDirectory(directoryPath, inheritedRules) {
    const directoryRules = addIgnoreRules(
      inheritedRules,
      await readIgnoreFileContents(join(directoryPath, ".gitignore"))
    );
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const resolvedPath = await realpath(join(directoryPath, entry.name));
      if (!isPathInside(scopePath, resolvedPath)) {
        throw new Error(`Source path must stay inside the base: ${join(directoryPath, entry.name)}`);
      }
      const relativePath = toPosixPath(relative2(scopePath, resolvedPath));
      if (entry.isDirectory()) {
        if (alwaysIgnoredDirectoryNames.has(entry.name)) continue;
        if (relativePath && isPathIgnored(directoryRules, relativePath, true)) continue;
        await visitDirectory(resolvedPath, directoryRules);
        continue;
      }
      if (relativePath && isPathIgnored(directoryRules, relativePath, false)) continue;
      await visitFile(resolvedPath);
    }
  }
  for (const sourcePath of sourcePaths) {
    const resolvedRoot = await realpath(isAbsolute2(sourcePath) ? sourcePath : resolve(scopePath, sourcePath));
    if (!isPathInside(scopePath, resolvedRoot)) {
      throw new Error(`Source path must stay inside the base: ${sourcePath}`);
    }
    const inheritedRules = resolvedRoot === scopePath ? (0, import_ignore.default)() : await collectInheritedIgnoreRules(scopePath, dirname(resolvedRoot));
    const rootStat = await stat(resolvedRoot);
    if (rootStat.isDirectory()) {
      await visitDirectory(resolvedRoot, inheritedRules);
    } else if (rootStat.isFile()) {
      await visitFile(resolvedRoot);
    }
  }
  return [...files].toSorted();
}

// src/plugins/artifact-generators/react-component-structure/analysis/load-typescript.ts
import { execFile } from "child_process";
import { createHash } from "crypto";
import { access, chmod, lstat, mkdir, mkdtemp, readFile as readFile2, rename, rm, rmdir } from "fs/promises";
import { createRequire } from "module";
import { homedir, tmpdir } from "os";
import { join as join2, resolve as resolve2 } from "path";
import { setTimeout } from "timers/promises";
import { promisify } from "util";

// node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/package.json
var version = "5.9.3";

// src/plugins/artifact-generators/react-component-structure/analysis/load-typescript.ts
var require2 = createRequire(import.meta.url);
var installations = /* @__PURE__ */ new Map();
async function hasCachedPackage(directory) {
  let contents;
  try {
    const cacheStat = await lstat(directory);
    if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
      throw new Error(`Unsafe TypeScript temporary cache directory: ${directory}`);
    }
    contents = await readFile2(join2(directory, "node_modules/typescript/package.json"), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
  if (JSON.parse(contents).version !== version) {
    throw new Error(`Unexpected TypeScript version in temporary cache: ${directory}`);
  }
  try {
    await access(require2.resolve(join2(directory, "node_modules/typescript")));
    await access(join2(directory, "node_modules/typescript/lib/lib.esnext.full.d.ts"));
    await access(join2(directory, "node_modules/typescript/lib/lib.es5.d.ts"));
  } catch (error) {
    if (isMissingPathError(error) || error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return false;
    }
    throw error;
  }
  return true;
}
async function acquireInstallationLock(cachePath) {
  const lockPath = `${cachePath}.lock`;
  const deadline = Date.now() + 12e4;
  for (; ; ) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for TypeScript temporary installation lock: ${lockPath}`);
    }
    try {
      await mkdir(lockPath, { mode: 448 });
      return () => rmdir(lockPath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    try {
      const lockStat = await lstat(lockPath);
      if (!lockStat.isDirectory() || process.getuid && lockStat.uid !== process.getuid()) {
        throw new Error(`Unsafe TypeScript temporary lock directory: ${lockPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    await setTimeout(50);
  }
}
async function installFallbackPackage(cacheRoot, cachePath) {
  const directory = await mkdtemp(join2(cacheRoot, `${version}-install-`));
  try {
    try {
      await promisify(execFile)(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
          "install",
          "--prefix",
          ".",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          "--no-save",
          `typescript@${version}`
        ],
        { cwd: directory, shell: process.platform === "win32", windowsHide: true, timeout: 12e4 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot install fallback TypeScript ${version}: ${message}`, { cause: error });
    }
    if (!await hasCachedPackage(directory)) {
      throw new Error(`npm did not install fallback TypeScript ${version}.`);
    }
    if (!await hasCachedPackage(cachePath)) {
      try {
        const cacheStat = await lstat(cachePath);
        if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
          throw new Error(`Unsafe TypeScript temporary cache directory: ${cachePath}`);
        }
        const quarantine = await mkdtemp(join2(cacheRoot, `${version}-invalid-`));
        await rename(cachePath, join2(quarantine, "cache"));
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    try {
      await rename(directory, cachePath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) {
        throw error;
      }
      if (!await hasCachedPackage(cachePath)) throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function installFallback(cacheRoot, cachePath) {
  const releaseLock = await acquireInstallationLock(cachePath);
  try {
    if (await hasCachedPackage(cachePath)) return;
    await installFallbackPackage(cacheRoot, cachePath);
  } finally {
    await releaseLock();
  }
}
async function loadFallback() {
  const user = createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
  const cacheRoot = join2(tmpdir(), `architecture-companion-typescript-${user}`);
  await mkdir(cacheRoot, { recursive: true, mode: 448 });
  const cacheStat = await lstat(cacheRoot);
  if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
    throw new Error(`Unsafe TypeScript temporary cache directory: ${cacheRoot}`);
  }
  if (process.platform !== "win32") await chmod(cacheRoot, 448);
  const cachePath = join2(cacheRoot, version);
  if (!await hasCachedPackage(cachePath)) {
    let installation = installations.get(cachePath);
    if (!installation) {
      installation = installFallback(cacheRoot, cachePath).finally(() => installations.delete(cachePath));
      installations.set(cachePath, installation);
    }
    await installation;
  }
  return require2(join2(cachePath, "node_modules/typescript"));
}
async function loadTypeScript(scopePath) {
  const targetRequire = createRequire(resolve2(scopePath, "package.json"));
  try {
    targetRequire.resolve("typescript/package.json");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return loadFallback();
    }
    throw error;
  }
  return targetRequire("typescript");
}

// src/plugins/artifact-generators/react-component-structure/analysis/build-component-graph.ts
function createComponentGraphBuilder(ts) {
  const COMPLEMENTARY_OPERATORS = {
    [ts.SyntaxKind.GreaterThanToken]: { family: "greater", inverted: false },
    [ts.SyntaxKind.LessThanEqualsToken]: { family: "greater", inverted: true },
    [ts.SyntaxKind.GreaterThanEqualsToken]: { family: "greater-or-equal", inverted: false },
    [ts.SyntaxKind.LessThanToken]: { family: "greater-or-equal", inverted: true },
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: { family: "equal", inverted: false },
    [ts.SyntaxKind.ExclamationEqualsEqualsToken]: { family: "equal", inverted: true },
    [ts.SyntaxKind.EqualsEqualsToken]: { family: "loosely-equal", inverted: false },
    [ts.SyntaxKind.ExclamationEqualsToken]: { family: "loosely-equal", inverted: true }
  };
  function formatDiagnostic(diagnostic) {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  }
  async function readCompilerOptions(scopePath, tsconfigPath) {
    const candidatePath = resolve3(scopePath, tsconfigPath ?? "tsconfig.json");
    let canonicalPath;
    try {
      canonicalPath = await realpath2(candidatePath);
    } catch (error) {
      if (!isMissingPathError(error) || tsconfigPath !== void 0) throw error;
    }
    let options = {};
    if (canonicalPath) {
      if (!isPathInside(scopePath, canonicalPath)) {
        throw new Error(`TypeScript config must stay inside the base: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      if (!(await lstat2(canonicalPath)).isFile()) {
        throw new Error(`TypeScript config must be a file: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      const config = ts.readConfigFile(canonicalPath, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${canonicalPath}: ${formatDiagnostic(config.error)}`);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve3(canonicalPath, ".."));
      if (parsed.errors.length > 0) {
        throw new Error(`Cannot parse ${canonicalPath}: ${parsed.errors.map(formatDiagnostic).join("\n")}`);
      }
      options = parsed.options;
    }
    return {
      ...options,
      allowJs: true,
      checkJs: false,
      composite: false,
      incremental: false,
      jsx: options.jsx ?? ts.JsxEmit.Preserve,
      module: options.module ?? ts.ModuleKind.ESNext,
      // Bundler resolution requires module ES2015+ or preserve; a tsconfig that
      // pins an older module (for example commonjs) must fall back to Node10.
      moduleResolution: options.moduleResolution ?? (options.module !== void 0 && options.module < ts.ModuleKind.ES2015 ? ts.ModuleResolutionKind.Node10 : ts.ModuleResolutionKind.Bundler),
      noEmit: true,
      skipLibCheck: true,
      target: options.target ?? ts.ScriptTarget.ESNext
    };
  }
  function unwrapExpression(expression) {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    }
    return current;
  }
  function collectReturnExpressions(body) {
    if (ts.isExpression(body)) return [body];
    const expressions = [];
    function visit(node) {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node)) {
        if (node.expression) expressions.push(node.expression);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(body);
    return expressions;
  }
  function getImportModuleSpecifier(symbol) {
    for (const declaration of symbol?.declarations ?? []) {
      const candidate = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent : ts.isNamespaceImport(declaration) ? declaration.parent.parent : ts.isImportClause(declaration) ? declaration.parent : void 0;
      if (candidate && ts.isImportDeclaration(candidate) && ts.isStringLiteral(candidate.moduleSpecifier)) {
        return candidate.moduleSpecifier.text;
      }
    }
    return void 0;
  }
  function getImportedName(symbol) {
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
      if (ts.isImportClause(declaration)) return "default";
      if (ts.isNamespaceImport(declaration)) return "*";
    }
    return void 0;
  }
  function isCreateElementCall(node, checker) {
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrapExpression(node.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text !== "createElement") return false;
      const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
      return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
    }
    if (!ts.isIdentifier(callee)) return false;
    const symbol = checker.getSymbolAtLocation(callee);
    return getImportModuleSpecifier(symbol) === "react" && getImportedName(symbol) === "createElement";
  }
  function isArrayRenderingMethodCall(call, checker) {
    const callee = unwrapExpression(call.expression);
    if (!ts.isPropertyAccessExpression(callee) || !["flatMap", "map"].includes(callee.name.text)) return false;
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration) return false;
    return /^lib\..*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName));
  }
  function containsReactOutput(expression, checker, visitedSymbols = /* @__PURE__ */ new Set()) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
      const symbol = canonicalSymbol(checker.getSymbolAtLocation(unwrapped), checker);
      if (symbol && !visitedSymbols.has(symbol)) {
        const next = new Set(visitedSymbols).add(symbol);
        if (symbol.declarations?.some(
          (declaration) => ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && containsReactOutput(declaration.initializer, checker, next)
        ))
          return true;
      }
    }
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped) || ts.isJsxFragment(unwrapped)) return true;
    if (ts.isCallExpression(unwrapped)) {
      if (isCreateElementCall(unwrapped, checker)) return true;
      if (!isArrayRenderingMethodCall(unwrapped, checker)) return false;
      return unwrapped.arguments.some(
        (argument) => (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && collectReturnExpressions(argument.body).some(
          (returned) => containsReactOutput(returned, checker, visitedSymbols)
        )
      );
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return containsReactOutput(unwrapped.whenTrue, checker, visitedSymbols) || containsReactOutput(unwrapped.whenFalse, checker, visitedSymbols);
    }
    if (ts.isBinaryExpression(unwrapped))
      return containsReactOutput(unwrapped.left, checker, visitedSymbols) || containsReactOutput(unwrapped.right, checker, visitedSymbols);
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return unwrapped.elements.some(
        (element) => ts.isExpression(element) && containsReactOutput(element, checker, visitedSymbols)
      );
    }
    return false;
  }
  function isReactWrapperCall(call, checker) {
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const symbol = checker.getSymbolAtLocation(callee);
      return getImportModuleSpecifier(symbol) === "react" && ["forwardRef", "memo"].includes(getImportedName(symbol) ?? "");
    }
    if (!ts.isPropertyAccessExpression(callee) || !["forwardRef", "memo"].includes(callee.name.text)) return false;
    const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
    return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
  }
  function unwrapFunction(initializer, checker) {
    const expression = unwrapExpression(initializer);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (!ts.isCallExpression(expression) || expression.arguments.length === 0 || !isReactWrapperCall(expression, checker)) {
      return void 0;
    }
    return unwrapFunction(expression.arguments.at(0), checker);
  }
  function isComponentName(name) {
    return /^[A-Z]/.test(name);
  }
  function defaultExportName(sourceFile) {
    const fileName = basename(sourceFile.fileName, extname2(sourceFile.fileName));
    const words = fileName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    const name = words.map((word) => `${word.at(0)?.toUpperCase()}${word.slice(1)}`).join("");
    return name || "DefaultExport";
  }
  function createComponentId(relativePath, identityName) {
    return `component:${relativePath}#${identityName}`;
  }
  function isDefaultExportDeclaration(declaration) {
    return declaration.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }
  function defaultExportSymbol(sourceFile, checker) {
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    return moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === "default") : void 0;
  }
  function collectComponentDefinitions(sourceFiles, scopePath, checker) {
    const definitions = [];
    const definitionIds = /* @__PURE__ */ new Set();
    const renderedSymbols = /* @__PURE__ */ new Set();
    function collectRenderedSymbols(node) {
      const reference = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node.tagName : ts.isCallExpression(node) && isCreateElementCall(node, checker) ? node.arguments.at(0) : void 0;
      const symbol = reference ? canonicalSymbol(checker.getSymbolAtLocation(reference), checker) : void 0;
      if (symbol) renderedSymbols.add(symbol);
      ts.forEachChild(node, collectRenderedSymbols);
    }
    for (const sourceFile of sourceFiles) collectRenderedSymbols(sourceFile);
    function addDefinition(sourceFile, declaration, name, symbol, functionLike, renderRoots, body, classComponent, identityName = name) {
      if (!isComponentName(name)) return;
      if (renderRoots.length === 0 || !renderRoots.some((root) => containsReactOutput(root, checker)) && !renderedSymbols.has(canonicalSymbol(symbol, checker)))
        return;
      const relativePath = toPosixPath(relative3(scopePath, sourceFile.fileName));
      const id = createComponentId(relativePath, identityName);
      if (definitionIds.has(id)) throw new Error(`Duplicate React component identity: ${id}`);
      definitionIds.add(id);
      definitions.push({
        id,
        name,
        filePath: sourceFile.fileName,
        relativePath,
        declaration,
        symbol,
        parameters: functionLike?.parameters ?? [],
        renderRoots,
        body,
        classComponent
      });
    }
    for (const sourceFile of sourceFiles) {
      for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.body) {
          const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
          const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : void 0);
          if (!name) continue;
          const roots = collectReturnExpressions(statement.body);
          addDefinition(
            sourceFile,
            statement,
            name,
            statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
            statement,
            roots,
            statement.body,
            false,
            anonymousDefault ? "default" : name
          );
          continue;
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            const functionLike = unwrapFunction(declaration.initializer, checker);
            if (!functionLike || !functionLike.body) continue;
            addDefinition(
              sourceFile,
              declaration,
              declaration.name.text,
              checker.getSymbolAtLocation(declaration.name),
              functionLike,
              collectReturnExpressions(functionLike.body),
              functionLike.body,
              false
            );
          }
          continue;
        }
        if (ts.isClassDeclaration(statement)) {
          const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
          const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : void 0);
          if (!name) continue;
          const renderMethod = statement.members.find(
            (member) => ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === "render" && !!member.body
          );
          if (!renderMethod?.body) continue;
          addDefinition(
            sourceFile,
            statement,
            name,
            statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
            void 0,
            collectReturnExpressions(renderMethod.body),
            renderMethod.body,
            true,
            anonymousDefault ? "default" : name
          );
          continue;
        }
        if (ts.isExportAssignment(statement)) {
          const functionLike = unwrapFunction(statement.expression, checker);
          if (!functionLike?.body) continue;
          const name = defaultExportName(sourceFile);
          addDefinition(
            sourceFile,
            statement,
            name,
            defaultExportSymbol(sourceFile, checker),
            functionLike,
            collectReturnExpressions(functionLike.body),
            functionLike.body,
            false,
            "default"
          );
        }
      }
    }
    return definitions.toSorted((left, right) => left.id.localeCompare(right.id));
  }
  function canonicalSymbol(symbol, checker) {
    if (!symbol) return void 0;
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
    return checker.getAliasedSymbol(symbol);
  }
  function resolveDefinition(symbol, checker, definitionsBySymbol, definitionsByDeclaration, visited = /* @__PURE__ */ new Set()) {
    if (!symbol || visited.has(symbol)) return void 0;
    const nextVisited = new Set(visited).add(symbol);
    const canonical = canonicalSymbol(symbol, checker);
    const direct = canonical ? definitionsBySymbol.get(canonical) : void 0;
    if (direct) return direct;
    for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
      const definition = definitionsByDeclaration.get(declaration);
      if (definition) return definition;
      if (ts.isExportAssignment(declaration)) {
        const expression = unwrapExpression(declaration.expression);
        if (ts.isCallExpression(expression) && isReactWrapperCall(expression, checker) && expression.arguments.length > 0) {
          const wrapped = unwrapExpression(expression.arguments.at(0));
          if (ts.isIdentifier(wrapped) || ts.isPropertyAccessExpression(wrapped)) {
            const aliasedDefinition = resolveDefinition(
              checker.getSymbolAtLocation(wrapped),
              checker,
              definitionsBySymbol,
              definitionsByDeclaration,
              nextVisited
            );
            if (aliasedDefinition) return aliasedDefinition;
          }
        }
        continue;
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer)) {
          const aliasedDefinition = resolveDefinition(
            checker.getSymbolAtLocation(initializer),
            checker,
            definitionsBySymbol,
            definitionsByDeclaration,
            nextVisited
          );
          if (aliasedDefinition) return aliasedDefinition;
        }
      }
    }
    return void 0;
  }
  function leftmostIdentifier(expression) {
    if (ts.isIdentifier(expression)) return expression;
    if (ts.isPropertyAccessExpression(expression)) return leftmostIdentifier(expression.expression);
    if (ts.isJsxNamespacedName(expression)) return leftmostIdentifier(expression.namespace);
    return void 0;
  }
  function externalPackageName(moduleSpecifier) {
    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/") || moduleSpecifier.startsWith("#")) {
      return void 0;
    }
    if (moduleSpecifier.startsWith("@")) return moduleSpecifier.split("/").slice(0, 2).join("/");
    return moduleSpecifier.split("/").at(0);
  }
  function externalPackageNameFromFile(fileName) {
    const normalized = toPosixPath(fileName);
    const marker = "/node_modules/";
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const modulePath = normalized.slice(markerIndex + marker.length);
      if (modulePath.startsWith("@")) return modulePath.split("/").slice(0, 2).join("/");
      const packageName = modulePath.split("/").at(0);
      return packageName && !packageName.startsWith(".") ? packageName : void 0;
    }
    let directory = resolve3(fileName, "..");
    while (true) {
      const manifestPath = ts.findConfigFile(directory, ts.sys.fileExists, "package.json");
      if (!manifestPath) return void 0;
      const { config } = ts.readConfigFile(manifestPath, ts.sys.readFile);
      if (typeof config?.name === "string") return config.name;
      const parent = resolve3(manifestPath, "../..");
      if (parent === resolve3(manifestPath, "..")) return void 0;
      directory = parent;
    }
  }
  function hasExternalDeclaration(symbol, context) {
    const canonical = canonicalSymbol(symbol, context.checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some(
      (declaration) => context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile())
    );
  }
  function isReactSymbol(symbol, checker) {
    if (getImportModuleSpecifier(symbol) === "react") return true;
    const canonical = canonicalSymbol(symbol, checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) => {
      const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
      return packageName === "react" || packageName === "@types/react";
    });
  }
  function declarationName(symbol, checker) {
    const canonical = canonicalSymbol(symbol, checker);
    for (const declaration of canonical?.declarations ?? []) {
      if ((ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) && declaration.name && ts.isIdentifier(declaration.name)) {
        return declaration.name.text;
      }
    }
    return canonical && canonical.name !== "default" && !canonical.name.startsWith('"') ? canonical.name : void 0;
  }
  function resolveReferenceMembers(symbol, location, names, checker) {
    const members = [];
    let type = checker.getTypeOfSymbolAtLocation(symbol, location);
    for (const name of names) {
      const member = checker.getPropertyOfType(type, name);
      const nextType = member ? checker.getTypeOfSymbolAtLocation(member, location) : checker.getIndexInfosOfType(type).find(({ keyType }) => checker.isTypeAssignableTo(checker.getStringLiteralType(name), keyType))?.type;
      if (!nextType) return void 0;
      members.push({ name, symbol: member, type: nextType });
      type = nextType;
    }
    return members;
  }
  function moduleBinding(symbol) {
    for (const declaration of symbol.declarations ?? []) {
      const candidate = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent : ts.isNamespaceImport(declaration) ? declaration.parent.parent : ts.isImportClause(declaration) ? declaration.parent : ts.isExportSpecifier(declaration) ? declaration.parent.parent : ts.isNamespaceExport(declaration) ? declaration.parent : void 0;
      if (!candidate || !ts.isImportDeclaration(candidate) && !ts.isExportDeclaration(candidate) || !candidate.moduleSpecifier || !ts.isStringLiteral(candidate.moduleSpecifier)) {
        continue;
      }
      const importedName = ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : ts.isImportClause(declaration) ? "default" : "*";
      return { moduleSpecifier: candidate.moduleSpecifier, importedName };
    }
    return void 0;
  }
  function symbolAliasChain(symbol, checker) {
    const chain = [];
    const visited = /* @__PURE__ */ new Set();
    let current = symbol;
    while (current && !visited.has(current)) {
      chain.push(current);
      visited.add(current);
      current = (current.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getImmediateAliasedSymbol(current) : void 0;
    }
    return chain;
  }
  function externalPackageForSymbol(symbol, checker) {
    const canonical = canonicalSymbol(symbol, checker);
    for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
      const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
      if (packageName) return packageName;
    }
    return void 0;
  }
  function externalSymbolOrigin(symbol, context, namespaceMembers = []) {
    const checker = context.checker;
    const chain = symbolAliasChain(symbol, checker);
    const canonical = canonicalSymbol(chain.at(-1), checker);
    const namespaceMember = namespaceMembers.at(0);
    const namespaceBinding = chain.map(moduleBinding).find((binding) => binding?.importedName === "*");
    const member = namespaceBinding ? namespaceMember?.symbol : void 0;
    const selected = canonicalSymbol(member, checker);
    const externalSymbol = selected?.declarations?.length ? selected : canonical;
    if (!externalSymbol?.declarations?.length) return void 0;
    const originFromBinding = (binding, visited = /* @__PURE__ */ new Set()) => {
      if (visited.has(binding.moduleSpecifier)) return void 0;
      const sourceFile = binding.moduleSpecifier.getSourceFile();
      const resolved = ts.resolveModuleName(
        binding.moduleSpecifier.text,
        sourceFile.fileName,
        context.program.getCompilerOptions(),
        context.host,
        void 0,
        void 0,
        context.program.getModeForUsageLocation(sourceFile, binding.moduleSpecifier)
      ).resolvedModule;
      if (resolved?.isExternalLibraryImport) {
        const packageName2 = externalPackageName(binding.moduleSpecifier.text);
        if (packageName2) return { packageName: packageName2, importedName: binding.importedName, symbol: externalSymbol };
      }
      const moduleSymbol = checker.getSymbolAtLocation(binding.moduleSpecifier);
      const nextVisited = new Set(visited).add(binding.moduleSpecifier);
      for (const declaration of moduleSymbol?.declarations ?? []) {
        if (!ts.isSourceFile(declaration)) continue;
        const hasExplicitExport = declaration.statements.some(
          (statement) => ts.isExportDeclaration(statement) && statement.exportClause && (ts.isNamespaceExport(statement.exportClause) ? statement.exportClause.name.text === binding.importedName : statement.exportClause.elements.some((member2) => member2.name.text === binding.importedName))
        );
        if (hasExplicitExport) continue;
        for (const statement of declaration.statements) {
          if (!ts.isExportDeclaration(statement) || statement.exportClause || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
          }
          const exportedModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
          const exported = exportedModule ? checker.getExportsOfModule(exportedModule).find((member2) => member2.name === binding.importedName) : void 0;
          if (canonicalSymbol(exported, checker) !== externalSymbol) continue;
          const origin = originFromBinding(
            { moduleSpecifier: statement.moduleSpecifier, importedName: binding.importedName },
            nextVisited
          );
          if (origin) return origin;
        }
      }
      return void 0;
    };
    for (const candidate of chain) {
      const binding = moduleBinding(candidate);
      const origin = binding ? originFromBinding(
        binding.importedName === "*" && namespaceMember ? { ...binding, importedName: namespaceMember.name } : binding
      ) : void 0;
      if (origin) return binding?.importedName === "*" ? { ...origin, importedName: "*" } : origin;
    }
    if (member) {
      const origin = externalSymbolOrigin(member, context, namespaceMembers.slice(1));
      if (origin) return { ...origin, namespaceDepth: (origin.namespaceDepth ?? 0) + 1 };
    }
    if (!hasExternalDeclaration(externalSymbol, context)) return void 0;
    const packageName = externalPackageForSymbol(externalSymbol, checker);
    return packageName ? { packageName, symbol: externalSymbol } : void 0;
  }
  function externalReferencePath(expression) {
    if (ts.isJsxNamespacedName(expression)) return void 0;
    let current = unwrapExpression(expression);
    const members = [];
    while (ts.isPropertyAccessExpression(current)) {
      members.unshift(current.name.text);
      current = unwrapExpression(current.expression);
    }
    return ts.isIdentifier(current) ? { root: current, members } : void 0;
  }
  function resolveExternalReference(expression, context, symbolOverride, visitedSymbols = /* @__PURE__ */ new Set(), remainingMembers = []) {
    const path = externalReferencePath(expression);
    if (!path) return void 0;
    const symbol = symbolOverride ?? context.checker.getSymbolAtLocation(path.root);
    if (!symbol || visitedSymbols.has(symbol)) return void 0;
    const members = [...path.members, ...remainingMembers];
    const selectedMembers = resolveReferenceMembers(symbol, expression, members, context.checker);
    if (!selectedMembers) return void 0;
    const origin = externalSymbolOrigin(symbol, context, selectedMembers);
    if (origin) {
      return { origin, members: selectedMembers.slice(origin.namespaceDepth ?? 0), localName: path.root.text };
    }
    const reference = localImmutableReference(symbol, context, visitedSymbols);
    if (!reference) return void 0;
    const resolved = /* @__PURE__ */ new Map();
    for (const initializer of reference.initializers) {
      const target = resolveExternalReference(initializer, context, void 0, reference.visitedSymbols, members);
      if (!target) continue;
      resolved.set(externalReferenceIdentity(target, context.checker).id, target);
    }
    return resolved.size === 1 ? [...resolved.values()].at(0) : void 0;
  }
  function externalReferenceIdentity(reference, checker) {
    const { origin, members, localName } = reference;
    const canonicalName = declarationName(origin.symbol, checker);
    const rootName = origin.importedName === "*" ? void 0 : origin.importedName === "default" ? canonicalName ?? "default" : origin.importedName ?? canonicalName;
    const path = members.map(({ name }) => name);
    const title = rootName ? [rootName, ...path].join(".") : path.length > 0 ? path.join(".") : canonicalName ?? localName;
    return { id: `external:${origin.packageName}#${title}`, title, externalPackage: origin.packageName };
  }
  function isIntrinsicJsxTag(tagName) {
    return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
  }
  function targetForReference(expression, context, symbolOverride) {
    const checker = context.checker;
    const external = resolveExternalReference(expression, context, symbolOverride);
    if (!external) {
      const symbol = symbolOverride ?? checker.getSymbolAtLocation(expression);
      const definition = resolveDefinition(
        symbol,
        checker,
        context.definitionsBySymbol,
        context.definitionsByDeclaration
      );
      return definition ? { id: definition.id, title: definition.name, definition } : void 0;
    }
    const target = externalReferenceIdentity(external, checker);
    if (target.externalPackage === "react" && /(?:^|\.)Fragment$/.test(target.title)) return void 0;
    const existing = context.externalTargets.get(target.id);
    if (existing) return existing;
    context.externalTargets.set(target.id, target);
    return target;
  }
  function componentUseId(ownerId, node, targetId, scopePath) {
    return [
      ownerId,
      toPosixPath(relative3(scopePath, node.getSourceFile().fileName)),
      node.pos,
      node.end,
      targetId
    ].join("\0");
  }
  function ensureComponentUse(ownerId, node, target, context) {
    const id = componentUseId(ownerId, node, target.id, context.scopePath);
    const existing = context.uses.get(id);
    if (existing) return existing;
    const use = { id, ownerId, target, suppliedValues: [] };
    context.uses.set(id, use);
    return use;
  }
  function addDirectUse(context, use) {
    const existing = context.directUseIdsByOwner.get(use.ownerId) ?? [];
    if (!existing.includes(use.id)) existing.push(use.id);
    context.directUseIdsByOwner.set(use.ownerId, existing);
  }
  function symbolForBindingName(name, checker) {
    return ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : void 0;
  }
  function isThisPropsExpression(expression) {
    const unwrapped = unwrapExpression(expression);
    return ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "props" && unwrapped.expression.kind === ts.SyntaxKind.ThisKeyword;
  }
  function createPropBindings(definition, checker) {
    const propsObjects = /* @__PURE__ */ new Set();
    const restObjects = /* @__PURE__ */ new Map();
    const propSymbols = /* @__PURE__ */ new Map();
    function addObjectBinding(pattern, inheritedExclusions) {
      const excluded = new Set(inheritedExclusions);
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          const restSymbol = symbolForBindingName(element.name, checker);
          if (restSymbol) restObjects.set(restSymbol, new Set(excluded));
          continue;
        }
        const propName = element.propertyName?.getText() ?? element.name.getText();
        excluded.add(propName);
        const symbol = symbolForBindingName(element.name, checker);
        if (symbol) propSymbols.set(symbol, propName);
      }
    }
    const firstParameter = definition.parameters.at(0);
    if (firstParameter) {
      if (ts.isIdentifier(firstParameter.name)) {
        const symbol = checker.getSymbolAtLocation(firstParameter.name);
        if (symbol) propsObjects.add(symbol);
      } else if (ts.isObjectBindingPattern(firstParameter.name)) {
        addObjectBinding(firstParameter.name, /* @__PURE__ */ new Set());
      }
    }
    function sourceExclusions(expression) {
      const unwrapped = unwrapExpression(expression);
      if (isThisPropsExpression(unwrapped)) return /* @__PURE__ */ new Set();
      if (!ts.isIdentifier(unwrapped)) return void 0;
      const symbol = checker.getSymbolAtLocation(unwrapped);
      if (!symbol) return void 0;
      if (propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
      return restObjects.get(symbol);
    }
    function incomingProp(expression) {
      const unwrapped = unwrapExpression(expression);
      if (ts.isIdentifier(unwrapped)) {
        const symbol = checker.getSymbolAtLocation(unwrapped);
        return symbol ? propSymbols.get(symbol) : void 0;
      }
      if (ts.isPropertyAccessExpression(unwrapped)) {
        const baseExclusions = sourceExclusions(unwrapped.expression);
        if (baseExclusions && !baseExclusions.has(unwrapped.name.text)) return unwrapped.name.text;
      }
      if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression)) {
        const baseExclusions = sourceExclusions(unwrapped.expression);
        if (baseExclusions && !baseExclusions.has(unwrapped.argumentExpression.text)) {
          return unwrapped.argumentExpression.text;
        }
      }
      return void 0;
    }
    if (definition.body && ts.isBlock(definition.body)) {
      let visit2 = function(node) {
        if (node !== definition.body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const exclusions = sourceExclusions(node.initializer);
          if (ts.isObjectBindingPattern(node.name) && exclusions) {
            addObjectBinding(node.name, exclusions);
          } else if (ts.isIdentifier(node.name)) {
            const targetSymbol = checker.getSymbolAtLocation(node.name);
            const propName = incomingProp(node.initializer);
            if (targetSymbol && propName) propSymbols.set(targetSymbol, propName);
            if (targetSymbol && exclusions) {
              if (exclusions.size === 0) propsObjects.add(targetSymbol);
              else restObjects.set(targetSymbol, exclusions);
            }
          }
        }
        ts.forEachChild(node, visit2);
      };
      var visit = visit2;
      visit2(definition.body);
    }
    return { propsObjects, restObjects, propSymbols, classComponent: definition.classComponent };
  }
  function getIncomingProp(expression, bindings, checker) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = checker.getSymbolAtLocation(unwrapped);
      return symbol ? bindings.propSymbols.get(symbol) : void 0;
    }
    function exclusionsFor(source) {
      const candidate = unwrapExpression(source);
      if (bindings.classComponent && isThisPropsExpression(candidate)) return /* @__PURE__ */ new Set();
      if (!ts.isIdentifier(candidate)) return void 0;
      const symbol = checker.getSymbolAtLocation(candidate);
      if (!symbol) return void 0;
      if (bindings.propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
      return bindings.restObjects.get(symbol);
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const exclusions = exclusionsFor(unwrapped.expression);
      if (exclusions && !exclusions.has(unwrapped.name.text)) return unwrapped.name.text;
    }
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression)) {
      const exclusions = exclusionsFor(unwrapped.expression);
      if (exclusions && !exclusions.has(unwrapped.argumentExpression.text)) return unwrapped.argumentExpression.text;
    }
    return void 0;
  }
  function getSpreadExclusions(expression, bindings, checker) {
    const unwrapped = unwrapExpression(expression);
    if (bindings.classComponent && isThisPropsExpression(unwrapped)) return /* @__PURE__ */ new Set();
    if (!ts.isIdentifier(unwrapped)) return void 0;
    const symbol = checker.getSymbolAtLocation(unwrapped);
    if (!symbol) return void 0;
    if (bindings.propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
    return bindings.restObjects.get(symbol);
  }
  function addExactRule(rules, propName, rule) {
    const existing = rules.exact.get(propName) ?? [];
    const key = JSON.stringify(rule);
    if (!existing.some((candidate) => JSON.stringify(candidate) === key)) existing.push(rule);
    rules.exact.set(propName, existing);
  }
  function jsxAttributeExpression(attribute) {
    if (!attribute.initializer) return void 0;
    if (ts.isJsxExpression(attribute.initializer)) return attribute.initializer.expression;
    if (ts.isJsxElement(attribute.initializer) || ts.isJsxSelfClosingElement(attribute.initializer)) {
      return attribute.initializer;
    }
    return void 0;
  }
  function isEffectiveJsxChild(child) {
    if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
    if (ts.isJsxExpression(child)) return !!child.expression;
    return true;
  }
  function propertyNameText(name) {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
    return void 0;
  }
  function localVariableReference(expression, context, visitedSymbols, symbolOverride) {
    const unwrapped = unwrapExpression(expression);
    if (!symbolOverride && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return void 0;
    const referenceSymbol = symbolOverride ?? context.checker.getSymbolAtLocation(unwrapped);
    const reference = referenceSymbol ? localImmutableReference(referenceSymbol, context, visitedSymbols) : void 0;
    if (!reference) return void 0;
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const root = externalReferencePath(unwrapped)?.root;
      const rootSymbol = root ? context.checker.getSymbolAtLocation(root) : void 0;
      if (rootSymbol && externalSymbolOrigin(rootSymbol, context)) return void 0;
      if (resolveExternalReference(unwrapped, context, void 0, visitedSymbols)) return void 0;
    }
    if (resolveDefinition(referenceSymbol, context.checker, context.definitionsBySymbol, context.definitionsByDeclaration)) {
      return void 0;
    }
    return reference;
  }
  function localImmutableReference(referenceSymbol, context, visitedSymbols) {
    if (externalSymbolOrigin(referenceSymbol, context)) return void 0;
    const symbol = canonicalSymbol(referenceSymbol, context.checker);
    if (!symbol || visitedSymbols.has(symbol)) return void 0;
    const initializers = (symbol.declarations ?? []).flatMap((declaration) => {
      if (context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile())) {
        return [];
      }
      if (ts.isExportAssignment(declaration)) return [declaration.expression];
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0) {
        return [];
      }
      return [declaration.initializer];
    });
    if (initializers.length === 0) return void 0;
    return { initializers, visitedSymbols: new Set(visitedSymbols).add(symbol) };
  }
  function resolveAliasedValues(expression, context, visitedSymbols = /* @__PURE__ */ new Set(), symbolOverride) {
    const unwrapped = unwrapExpression(expression);
    const property = symbolOverride ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
    if (property) {
      return resolveAliasedValues(property.value, context, visitedSymbols, property.valueSymbol);
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols, symbolOverride);
    if (!reference) return [unwrapped];
    return reference.initializers.flatMap(
      (initializer) => resolveAliasedValues(initializer, context, reference.visitedSymbols)
    );
  }
  function collectStaticObjectProperties(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const values2 = /* @__PURE__ */ new Map();
      let hasUnknownSpread2 = false;
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) {
          const propName = propertyNameText(property.name);
          if (propName) values2.set(propName, { propName, value: property.initializer });
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const propName = propertyNameText(property.name);
          if (propName) {
            values2.set(propName, {
              propName,
              value: property.name,
              valueSymbol: context.checker.getShorthandAssignmentValueSymbol(property)
            });
          }
        } else if (ts.isSpreadAssignment(property)) {
          const spread = collectStaticObjectProperties(property.expression, context, visitedSymbols);
          if (spread.hasUnknownSpread) {
            values2.clear();
            hasUnknownSpread2 = true;
          }
          for (const [propName, value] of spread.values) values2.set(propName, value);
        }
      }
      return { hasUnknownSpread: hasUnknownSpread2, values: values2 };
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols);
    if (!reference) return { hasUnknownSpread: true, values: /* @__PURE__ */ new Map() };
    const values = /* @__PURE__ */ new Map();
    let hasUnknownSpread = false;
    for (const initializer of reference.initializers) {
      const resolved = collectStaticObjectProperties(initializer, context, reference.visitedSymbols);
      if (resolved.hasUnknownSpread) {
        values.clear();
        hasUnknownSpread = true;
      }
      for (const [propName, value] of resolved.values) values.set(propName, value);
    }
    return { hasUnknownSpread, values };
  }
  function staticObjectPropertyValues(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    return [...collectStaticObjectProperties(expression, context, visitedSymbols).values.values()];
  }
  function staticObjectPropertyValue(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    const unwrapped = unwrapExpression(expression);
    const property = ts.isPropertyAccessExpression(unwrapped) ? { name: unwrapped.name.text, source: unwrapped.expression } : ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression) ? { name: unwrapped.argumentExpression.text, source: unwrapped.expression } : void 0;
    if (!property) return void 0;
    return staticObjectPropertyValues(property.source, context, visitedSymbols).find(
      ({ propName }) => propName === property.name
    );
  }
  function analyzeConsumerRules(definition, context, bindings) {
    const rules = { exact: /* @__PURE__ */ new Map(), spreads: [] };
    const mutableSpreads = rules.spreads;
    let activeRuleset = [[]];
    function terminal(propName, kind) {
      addExactRule(rules, propName, { type: "terminal", kind, ruleset: activeRuleset });
    }
    function inActiveRules(rule) {
      return activeRuleset.some(
        (prefix) => prefix.every(
          (requirement) => rule.some(({ controlId, value }) => controlId === requirement.controlId && value === requirement.value)
        )
      );
    }
    function removeActiveForwarding(matches) {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.flatMap((rule) => {
            if (rule.type !== "forward" || !matches(rule)) return [rule];
            const kept = rule.ruleset.filter((requirement) => !inActiveRules(requirement));
            return kept.length > 0 ? [{ ...rule, ruleset: kept }] : [];
          })
        );
      }
    }
    function removeForwardingToProp(targetUseId, targetPropName) {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId && rule.targetPropName === targetPropName);
      for (const [index, spread] of [...mutableSpreads].entries()) {
        if (spread.targetUseId !== targetUseId) continue;
        const ruleset = spread.ruleset.filter(inActiveRules);
        if (ruleset.length === 0) continue;
        const retained = spread.ruleset.filter((rule) => !inActiveRules(rule));
        if (retained.length > 0) mutableSpreads.push({ ...spread, ruleset: retained });
        mutableSpreads[index] = {
          ...spread,
          ruleset,
          excludedProps: new Set(spread.excludedProps).add(targetPropName)
        };
      }
    }
    function removeForwardingOverriddenBySpread(targetUseId, excludedProps) {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId && !excludedProps.has(rule.targetPropName));
    }
    function clearForwardingToTarget(targetUseId) {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId);
      for (let index = mutableSpreads.length - 1; index >= 0; index -= 1) {
        const spread = mutableSpreads[index];
        if (spread.targetUseId !== targetUseId) continue;
        const ruleset = spread.ruleset.filter((rule) => !inActiveRules(rule));
        if (ruleset.length === 0) mutableSpreads.splice(index, 1);
        else mutableSpreads[index] = { ...spread, ruleset };
      }
    }
    function collectInvokedRenderProps(expression, traverseRootFunction, initialRuleset = activeRuleset) {
      const props = /* @__PURE__ */ new Map();
      const activeNodes = /* @__PURE__ */ new Set();
      function visit(node, ruleset, isRoot) {
        if (activeNodes.has(node)) return;
        activeNodes.add(node);
        try {
          visitValue(node, ruleset, isRoot);
        } finally {
          activeNodes.delete(node);
        }
      }
      function visitValue(node, ruleset, isRoot) {
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          if (isRoot && traverseRootFunction)
            controlledReturns(node.body, definition.id, context, (value, next) => visit(value, next, false), ruleset);
          return;
        }
        if (ts.isFunctionLike(node)) return;
        if (ts.isExpression(node) && controlledExpression(node, definition.id, ruleset, context, (value, next) => visit(value, next, false)))
          return;
        if (ts.isCallExpression(node)) {
          const propName = getIncomingProp(node.expression, bindings, context.checker);
          if (propName) {
            const entry = { propName, ruleset };
            props.set(JSON.stringify(entry), entry);
            return;
          }
        }
        if (ts.isExpression(node)) {
          const values = resolveAliasedValues(node, context);
          if (values.some((value) => value !== unwrapExpression(node))) {
            for (const value of values) visit(value, ruleset, isRoot);
            return;
          }
        }
        ts.forEachChild(node, (child) => visit(child, ruleset, false));
      }
      visit(expression, initialRuleset, true);
      return [...props.values()];
    }
    function analyzeRenderPropInvocations(expression) {
      for (const { propName, ruleset } of collectInvokedRenderProps(expression, false))
        addExactRule(rules, propName, { type: "terminal", kind: "render-prop", ruleset });
    }
    function collectForwardedProps(expression, symbolOverride) {
      const props = /* @__PURE__ */ new Map();
      function collect(candidate, ruleset, visitedSymbols, candidateSymbol) {
        if (controlledExpression(
          candidate,
          definition.id,
          ruleset,
          context,
          (value, next) => collect(value, next, visitedSymbols)
        ))
          return;
        const unwrapped = unwrapExpression(candidate);
        const directProp = candidateSymbol ? bindings.propSymbols.get(candidateSymbol) : getIncomingProp(unwrapped, bindings, context.checker);
        if (directProp) {
          const entry = { propName: directProp, ruleset };
          props.set(JSON.stringify(entry), entry);
          return;
        }
        const property = candidateSymbol ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
        if (property) {
          collect(property.value, ruleset, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
          for (const entry of collectInvokedRenderProps(unwrapped, true, ruleset))
            props.set(JSON.stringify(entry), entry);
          return;
        }
        if (ts.isObjectLiteralExpression(unwrapped)) {
          for (const property2 of staticObjectPropertyValues(unwrapped, context))
            collect(property2.value, ruleset, visitedSymbols, property2.valueSymbol);
          return;
        }
        if (ts.isArrayLiteralExpression(unwrapped)) {
          for (const element of unwrapped.elements)
            if (ts.isExpression(element)) collect(element, ruleset, visitedSymbols);
          return;
        }
        const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
        if (!reference) return;
        for (const initializer of reference.initializers) collect(initializer, ruleset, reference.visitedSymbols);
      }
      collect(expression, activeRuleset, /* @__PURE__ */ new Set(), symbolOverride);
      return [...props.values()];
    }
    function collectForwardedSpreadExclusions(expression, visitedSymbols = /* @__PURE__ */ new Set()) {
      const unwrapped = unwrapExpression(expression);
      const direct = getSpreadExclusions(unwrapped, bindings, context.checker);
      if (direct) return [direct];
      if (ts.isObjectLiteralExpression(unwrapped)) {
        return unwrapped.properties.flatMap(
          (property) => ts.isSpreadAssignment(property) ? collectForwardedSpreadExclusions(property.expression, visitedSymbols) : []
        );
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return [];
      return reference.initializers.flatMap(
        (initializer) => collectForwardedSpreadExclusions(initializer, reference.visitedSymbols)
      );
    }
    function analyzeJsxAttributes(attributes, targetUseId, children) {
      for (const property of attributes.properties) {
        if (ts.isJsxAttribute(property)) {
          const targetPropName = property.name.getText();
          if (targetUseId) removeForwardingToProp(targetUseId, targetPropName);
          const expression = jsxAttributeExpression(property);
          if (!expression) continue;
          analyzeRenderPropInvocations(expression);
          if (!targetUseId) continue;
          for (const { propName, ruleset } of collectForwardedProps(expression)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName,
              ruleset
            });
          }
        } else if (targetUseId) {
          const forwardedSpreads = collectForwardedSpreadExclusions(property.expression);
          const staticProperties = collectStaticObjectProperties(property.expression, context);
          if (forwardedSpreads.length === 0 && staticProperties.hasUnknownSpread) {
            clearForwardingToTarget(targetUseId);
          }
          for (const excludedProps of forwardedSpreads) {
            removeForwardingOverriddenBySpread(targetUseId, excludedProps);
            mutableSpreads.push({ excludedProps, targetUseId, ruleset: activeRuleset });
          }
          for (const forwarded of staticProperties.values.values()) {
            removeForwardingToProp(targetUseId, forwarded.propName);
            analyzeRenderPropInvocations(forwarded.value);
            for (const { propName, ruleset } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
              addExactRule(rules, propName, {
                type: "forward",
                targetUseId,
                targetPropName: forwarded.propName,
                ruleset
              });
            }
          }
        }
      }
      const effectiveChildren = children.filter(isEffectiveJsxChild);
      if (targetUseId && effectiveChildren.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of effectiveChildren) {
        if (ts.isJsxExpression(child) && child.expression) analyzeRenderPropInvocations(child.expression);
        if (!targetUseId || !ts.isJsxExpression(child) || !child.expression) continue;
        for (const { propName, ruleset } of collectForwardedProps(child.expression)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", ruleset });
        }
      }
    }
    function analyzeIntrinsicSpreadAttributes(attributes, children) {
      if (children.filter(isEffectiveJsxChild).length > 0) return;
      for (const property of attributes.properties) {
        if (ts.isJsxAttribute(property)) continue;
        for (const excludedProps of collectForwardedSpreadExclusions(property.expression)) {
          if (!excludedProps.has("children")) terminal("children", "node-prop");
        }
      }
    }
    const activeExpressions = /* @__PURE__ */ new Set();
    function analyzeRendered(expression, ruleset = activeRuleset) {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      const previous = activeRuleset;
      activeRuleset = ruleset;
      try {
        if (!controlledExpression(expression, definition.id, ruleset, context, analyzeRendered))
          analyzeRenderedValue(expression);
      } finally {
        activeRuleset = previous;
        activeExpressions.delete(expression);
      }
    }
    function analyzeRenderedValue(expression) {
      const unwrapped = unwrapExpression(expression);
      const directProp = getIncomingProp(unwrapped, bindings, context.checker);
      if (directProp) {
        terminal(directProp, "node-prop");
        return;
      }
      if (ts.isCallExpression(unwrapped)) {
        const invokedProp = getIncomingProp(unwrapped.expression, bindings, context.checker);
        if (invokedProp) {
          terminal(invokedProp, "render-prop");
          return;
        }
        if (isCreateElementCall(unwrapped, context.checker)) {
          analyzeCreateElement(unwrapped);
          return;
        }
        if (isArrayRenderingMethodCall(unwrapped, context.checker)) {
          for (const argument of unwrapped.arguments) {
            if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
              controlledReturns(argument.body, definition.id, context, analyzeRendered, activeRuleset);
            }
          }
        }
        return;
      }
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeJsxChild(child);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        const componentProp = getIncomingProp(opening.tagName, bindings, context.checker);
        if (componentProp) {
          terminal(componentProp, "component-prop");
          return;
        }
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeJsxChild(child);
          analyzeIntrinsicSpreadAttributes(opening.attributes, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        const targetUseId = target ? componentUseId(definition.id, unwrapped, target.id, context.scopePath) : void 0;
        analyzeJsxAttributes(opening.attributes, targetUseId, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) analyzeRendered(element);
        }
        return;
      }
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        controlledReturns(unwrapped.body, definition.id, context, analyzeRendered, activeRuleset);
        return;
      }
      for (const value of resolveAliasedValues(unwrapped, context)) {
        if (value !== unwrapped) analyzeRendered(value);
      }
    }
    function analyzeJsxChild(child) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
        analyzeRendered(child);
    }
    function analyzeCreateElement(call) {
      const [tagExpression, propsExpression, ...children] = call.arguments;
      if (!tagExpression) return;
      const componentProp = getIncomingProp(tagExpression, bindings, context.checker);
      if (componentProp) {
        terminal(componentProp, "component-prop");
        return;
      }
      if (ts.isStringLiteral(tagExpression)) {
        for (const child of children) analyzeRendered(child);
        return;
      }
      const target = targetForReference(tagExpression, context);
      const targetUseId = target ? componentUseId(definition.id, call, target.id, context.scopePath) : void 0;
      if (propsExpression && targetUseId) {
        for (const excludedProps of collectForwardedSpreadExclusions(propsExpression)) {
          mutableSpreads.push({ excludedProps, targetUseId, ruleset: activeRuleset });
        }
        for (const forwarded of staticObjectPropertyValues(propsExpression, context)) {
          removeForwardingToProp(targetUseId, forwarded.propName);
          analyzeRenderPropInvocations(forwarded.value);
          for (const { propName, ruleset } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName: forwarded.propName,
              ruleset
            });
          }
        }
      }
      if (targetUseId && children.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of children) {
        analyzeRenderPropInvocations(child);
        if (!targetUseId) continue;
        for (const { propName, ruleset } of collectForwardedProps(child)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", ruleset });
        }
      }
    }
    if (definition.body) controlledReturns(definition.body, definition.id, context, analyzeRendered);
    else for (const root of definition.renderRoots) analyzeRendered(root);
    return rules;
  }
  function relationshipKey(relationship) {
    return [
      relationship.source,
      relationship.target,
      relationship.kind,
      relationship.kind === "inline-render" ? "" : relationship.propName
    ].join("\0");
  }
  function returnedUses(callback, ownerId, context, initialRuleset = [[]], rulesetsByUse = /* @__PURE__ */ new Map()) {
    const uses = /* @__PURE__ */ new Map();
    controlledReturns(
      callback.body,
      ownerId,
      context,
      (expression, ruleset) => {
        for (const use of collectSuppliedUses([expression], ownerId, context, ruleset, rulesetsByUse))
          uses.set(use.id, use);
      },
      initialRuleset
    );
    return [...uses.values()];
  }
  function collectSuppliedUses(expressions, ownerId, context, initialRuleset = [[]], rulesetsByUse = /* @__PURE__ */ new Map()) {
    const uses = /* @__PURE__ */ new Map();
    const activeExpressions = /* @__PURE__ */ new Set();
    function collect(expression, ruleset, visitedSymbols = /* @__PURE__ */ new Set()) {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        collectValue(expression, ruleset, visitedSymbols);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function collectValue(expression, ruleset, visitedSymbols) {
      if (controlledExpression(
        expression,
        ownerId,
        ruleset,
        context,
        (candidate, next) => collect(candidate, next, visitedSymbols)
      ))
        return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) collectChild(child, ruleset);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) collectChild(child, ruleset);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUseRuleset(context, use.id, ruleset, rulesetsByUse);
          analyzeJsxComponentUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) collect(child, ruleset);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUseRuleset(context, use.id, ruleset, rulesetsByUse);
          analyzeCreateElementUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            controlledReturns(
              argument.body,
              ownerId,
              context,
              (returned, next) => collect(returned, next, visitedSymbols),
              ruleset
            );
          }
        }
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        collect(unwrapped.right, ruleset, visitedSymbols);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements)
          if (ts.isExpression(element)) collect(element, ruleset, visitedSymbols);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, ruleset, reference.visitedSymbols);
    }
    function collectChild(child, ruleset) {
      if (ts.isJsxExpression(child) && child.expression) collect(child.expression, ruleset);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
        collect(child, ruleset);
    }
    for (const expression of expressions) collect(expression, initialRuleset);
    return [...uses.values()];
  }
  function componentReferenceUses(expression, ownerId, context, symbolOverride, rulesetsByUse = /* @__PURE__ */ new Map()) {
    const uses = /* @__PURE__ */ new Map();
    function collect(candidate, visitedSymbols, candidateSymbol, ruleset = [[]]) {
      if (controlledExpression(
        candidate,
        ownerId,
        ruleset,
        context,
        (expression2, next) => collect(expression2, visitedSymbols, void 0, next)
      ))
        return;
      const unwrapped = unwrapExpression(candidate);
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property2 of unwrapped.properties) {
          if (ts.isPropertyAssignment(property2)) collect(property2.initializer, visitedSymbols, void 0, ruleset);
          else if (ts.isShorthandPropertyAssignment(property2)) {
            collect(
              property2.name,
              visitedSymbols,
              context.checker.getShorthandAssignmentValueSymbol(property2),
              ruleset
            );
          } else if (ts.isSpreadAssignment(property2)) collect(property2.expression, visitedSymbols, void 0, ruleset);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) collect(element, visitedSymbols, void 0, ruleset);
        }
        return;
      }
      if (!candidateSymbol && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;
      const property = candidateSymbol ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
      if (property) {
        collect(property.value, visitedSymbols, property.valueSymbol, ruleset);
        return;
      }
      const target = targetForReference(unwrapped, context, candidateSymbol);
      const valueSymbol = canonicalSymbol(
        candidateSymbol ?? context.checker.getSymbolAtLocation(unwrapped),
        context.checker
      );
      const valueType = valueSymbol ? context.checker.getTypeOfSymbolAtLocation(valueSymbol, unwrapped) : context.checker.getTypeAtLocation(unwrapped);
      const callable = valueType.getCallSignatures().length + valueType.getConstructSignatures().length > 0;
      const externalName = target?.title.split(".").at(-1);
      if (target && (target.definition || callable && !!externalName && /^[A-Z]/.test(externalName))) {
        const use = ensureComponentUse(ownerId, unwrapped, target, context);
        addUseRuleset(context, use.id, ruleset, rulesetsByUse);
        uses.set(use.id, use);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
      if (!reference) return;
      for (const initializer of reference.initializers)
        collect(initializer, reference.visitedSymbols, void 0, ruleset);
    }
    collect(expression, /* @__PURE__ */ new Set(), symbolOverride);
    return [...uses.values()];
  }
  function addSuppliedValue(receiver, propName, kind, targets, rulesetsByUse) {
    if (targets.length === 0) return;
    receiver.suppliedValues.push({
      propName,
      kind,
      targets: targets.map(({ id }) => ({ useId: id, ruleset: rulesetsByUse.get(id) ?? [[]] }))
    });
  }
  function analyzeSuppliedValue(receiver, propName, expression, context, symbolOverride) {
    const rulesetsByUse = /* @__PURE__ */ new Map();
    const componentUses = componentReferenceUses(expression, receiver.ownerId, context, symbolOverride, rulesetsByUse);
    if (componentUses.length > 0) {
      addSuppliedValue(receiver, propName, "component-prop", componentUses, rulesetsByUse);
      return;
    }
    const values = resolveAliasedValues(expression, context, /* @__PURE__ */ new Set(), symbolOverride);
    const renderUses = /* @__PURE__ */ new Map();
    function collectCallbacks(value, ruleset) {
      if (controlledExpression(value, receiver.ownerId, ruleset, context, collectCallbacks)) return;
      const unwrapped = unwrapExpression(value);
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        for (const use of returnedUses(unwrapped, receiver.ownerId, context, ruleset, rulesetsByUse))
          renderUses.set(use.id, use);
        return;
      }
      for (const candidate of resolveAliasedValues(unwrapped, context))
        if (candidate !== unwrapped) collectCallbacks(candidate, ruleset);
    }
    for (const value of values) collectCallbacks(value, [[]]);
    if (renderUses.size > 0) {
      addSuppliedValue(receiver, propName, "render-prop", [...renderUses.values()], rulesetsByUse);
      return;
    }
    addSuppliedValue(
      receiver,
      propName,
      "node-prop",
      collectSuppliedUses(values, receiver.ownerId, context, [[]], rulesetsByUse),
      rulesetsByUse
    );
  }
  function analyzeJsxComponentUsage(element, receiver, context) {
    if (context.analyzedUseIds.has(receiver.id)) return;
    context.analyzedUseIds.add(receiver.id);
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const valuesByProp = /* @__PURE__ */ new Map();
    for (const property of opening.attributes.properties) {
      if (ts.isJsxAttribute(property)) {
        const expression = jsxAttributeExpression(property);
        if (expression)
          valuesByProp.set(property.name.getText(), { propName: property.name.getText(), value: expression });
        continue;
      }
      for (const value of staticObjectPropertyValues(property.expression, context)) {
        valuesByProp.set(value.propName, value);
      }
    }
    for (const { propName, value, valueSymbol } of valuesByProp.values()) {
      analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
    }
    if (ts.isJsxElement(element)) {
      for (const child of element.children) {
        const expression = ts.isJsxExpression(child) ? child.expression : ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child) ? child : void 0;
        if (expression) analyzeSuppliedValue(receiver, "children", expression, context);
      }
    }
  }
  function analyzeCreateElementUsage(call, receiver, context) {
    if (context.analyzedUseIds.has(receiver.id)) return;
    context.analyzedUseIds.add(receiver.id);
    const [, propsExpression, ...children] = call.arguments;
    if (propsExpression) {
      for (const { propName, value, valueSymbol } of staticObjectPropertyValues(propsExpression, context)) {
        analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
      }
    }
    for (const child of children) analyzeSuppliedValue(receiver, "children", child, context);
  }
  function conditionControlId(node, ownerId, label, when, context, alternatives) {
    const suffix = createHash2("sha256").update(`${toPosixPath(relative3(context.scopePath, node.getSourceFile().fileName))}:${node.pos}:${node.end}`).digest("hex").slice(0, 16);
    const id = `${ownerId}:control:${suffix}`;
    const existing = context.controls.get(id);
    const base = { id, owner: ownerId, label, dependsOn: unionRulesets(existing?.dependsOn ?? [], when) };
    context.controls.set(
      id,
      alternatives ? {
        ...base,
        kind: "branch",
        cases: alternatives.cases,
        ...alternatives.polarityPair ? { polarityPair: true } : {}
      } : { ...base, kind: "conditional" }
    );
    return id;
  }
  function controlRuleset(node, ownerId, label, when, context, alternatives) {
    const id = conditionControlId(node, ownerId, label, when, context, alternatives);
    return (value) => combineRulesets(when, [[{ controlId: id, value }]]);
  }
  const normalizedLabel = (label) => {
    let text = label.trim();
    for (; ; ) {
      if (text.startsWith("!(") && text.endsWith(")")) {
        const inner = text.slice(2, -1).trim();
        if (!inner.startsWith("!") || inner.length === 1) return text;
        text = normalizedLabel(inner.slice(1).trim());
        continue;
      }
      if (text.startsWith("!!")) {
        text = text.slice(2).trim();
        continue;
      }
      return text;
    }
  };
  const negateLabel = (label) => {
    const text = normalizedLabel(label);
    if (text.startsWith("!") && !text.startsWith("!=")) return normalizedLabel(text.slice(1).trim());
    return /[<>=+\-*%&|?]|\s/.test(text) ? `!(${text})` : `!${text}`;
  };
  const positiveLabel = (label) => {
    let text = normalizedLabel(label);
    for (; ; ) {
      if (text.startsWith("!(") && text.endsWith(")")) {
        text = normalizedLabel(text.slice(2, -1).trim());
        continue;
      }
      if (text.startsWith("!") && !text.startsWith("!=") && text.length > 1) {
        text = normalizedLabel(text.slice(1).trim());
        continue;
      }
      return text;
    }
  };
  const polarityPairCases = (label) => {
    const trueCase = { id: "true", label };
    const falseCase = { id: "false", label: negateLabel(label) };
    return normalizedLabel(label) === positiveLabel(label) ? [trueCase, falseCase] : [falseCase, trueCase];
  };
  const MAX_DECOMPOSED_CLAUSES = 8;
  const MAX_DECOMPOSED_LITERALS = 8;
  const literalCaseText = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? `"${node.text}"` : ts.isNumericLiteral(node) ? node.text : node.getText();
  const isGateCombination = (expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken)
      return isGateCombination(unwrapped.operand);
    return ts.isBinaryExpression(unwrapped) && (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken);
  };
  const negateClauses = (clauses) => {
    const flip = (literal) => ({
      expression: literal.expression,
      positive: !literal.positive
    });
    let expanded = [[]];
    for (const clause of clauses) {
      const next = [];
      for (const base of expanded) for (const literal of clause) next.push([...base, flip(literal)]);
      expanded = next;
    }
    return expanded.length > MAX_DECOMPOSED_CLAUSES ? void 0 : expanded;
  };
  const conditionClauses = (expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = conditionClauses(unwrapped.operand);
      if (!operand) return void 0;
      const only = operand.length === 1 ? operand.at(0) : void 0;
      if (only && only.length === 1 && only.at(0).positive) return [[{ expression: unwrapped, positive: true }]];
      return negateClauses(operand);
    }
    if (ts.isBinaryExpression(unwrapped) && (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      const left = conditionClauses(unwrapped.left);
      const right = conditionClauses(unwrapped.right);
      if (!left || !right) return void 0;
      const merged = unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ? [...left, ...right] : left.flatMap((clause) => right.map((other) => [...clause, ...other]));
      if (merged.length > MAX_DECOMPOSED_CLAUSES || merged.some((clause) => clause.length > MAX_DECOMPOSED_LITERALS))
        return void 0;
      return merged;
    }
    return [[{ expression: unwrapped, positive: true }]];
  };
  const conditionRequirements = (clauses, ownerId, when, context) => {
    const rules = [];
    for (const clause of clauses) {
      const rule = [];
      const chosen = /* @__PURE__ */ new Set();
      let contradiction = false;
      for (const literal of clause) {
        const label = normalizedLabel(literal.expression.getText());
        const controlId = conditionControlId(literal.expression, ownerId, label, when, context);
        const value = literal.positive ? "on" : "off";
        if (chosen.has(`${controlId}\0${literal.positive ? "off" : "on"}`)) {
          contradiction = true;
          break;
        }
        if (chosen.has(`${controlId}\0${value}`)) continue;
        chosen.add(`${controlId}\0${value}`);
        rule.push({ controlId, value });
      }
      if (!contradiction) rules.push(rule);
    }
    return rules;
  };
  function isEmptyOutput(expression, context) {
    return resolveAliasedValues(expression, context).every(
      (unwrapped) => unwrapped.kind === ts.SyntaxKind.NullKeyword || unwrapped.kind === ts.SyntaxKind.FalseKeyword || unwrapped.kind === ts.SyntaxKind.TrueKeyword || ts.isIdentifier(unwrapped) && unwrapped.text === "undefined" || ts.isVoidExpression(unwrapped)
    );
  }
  function controlledExpression(expression, ownerId, ruleset, context, visit) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isConditionalExpression(unwrapped)) {
      const emptyTrue = isEmptyOutput(unwrapped.whenTrue, context);
      const emptyFalse = isEmptyOutput(unwrapped.whenFalse, context);
      if (emptyTrue && emptyFalse) return true;
      if (isGateCombination(unwrapped.condition)) {
        const trueClauses = conditionClauses(unwrapped.condition);
        const falseClauses = trueClauses && negateClauses(trueClauses);
        const trueReady = emptyTrue || trueClauses !== void 0;
        const falseReady = emptyFalse || falseClauses !== void 0;
        if (trueReady && falseReady) {
          if (!emptyTrue)
            visit(
              unwrapped.whenTrue,
              combineRulesets(ruleset, conditionRequirements(trueClauses, ownerId, ruleset, context))
            );
          if (!emptyFalse)
            visit(
              unwrapped.whenFalse,
              combineRulesets(ruleset, conditionRequirements(falseClauses, ownerId, ruleset, context))
            );
          return true;
        }
      }
      const label = normalizedLabel(unwrapped.condition.getText());
      const select = controlRuleset(
        unwrapped,
        ownerId,
        emptyTrue ? negateLabel(label) : emptyFalse ? label : positiveLabel(label),
        ruleset,
        context,
        emptyTrue || emptyFalse ? void 0 : {
          cases: polarityPairCases(label),
          polarityPair: true
        }
      );
      if (!emptyTrue) visit(unwrapped.whenTrue, select(emptyFalse ? "on" : "true"));
      if (!emptyFalse) visit(unwrapped.whenFalse, select(emptyTrue ? "on" : "false"));
      return true;
    }
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      let conjunction2 = function(condition, node, when) {
        const guard = unwrapExpression(condition);
        const operandClauses = (operand, prerequisites) => {
          if (!isGateCombination(operand)) return void 0;
          const clauses = conditionClauses(operand);
          return clauses ? conditionRequirements(clauses, ownerId, prerequisites, context) : void 0;
        };
        if (ts.isBinaryExpression(guard) && guard.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          const prerequisites = conjunction2(guard.left, guard, when);
          const decomposed2 = operandClauses(guard.right, prerequisites);
          if (decomposed2) return combineRulesets(prerequisites, decomposed2);
          return controlRuleset(node, ownerId, normalizedLabel(guard.right.getText()), prerequisites, context)("on");
        }
        const decomposed = operandClauses(guard, when);
        if (decomposed) return decomposed;
        return controlRuleset(node, ownerId, normalizedLabel(condition.getText()), when, context)("on");
      };
      var conjunction = conjunction2;
      visit(unwrapped.right, conjunction2(unwrapped.left, unwrapped, ruleset));
      return true;
    }
    if (ts.isBinaryExpression(unwrapped) && (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken || unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      let hasOutput2 = function(expression2, visited = /* @__PURE__ */ new Set()) {
        const candidate = unwrapExpression(expression2);
        if (containsReactOutput(candidate, context.checker, visited) || bindings && getIncomingProp(
          ts.isCallExpression(candidate) ? candidate.expression : candidate,
          bindings,
          context.checker
        ))
          return true;
        if (ts.isConditionalExpression(candidate))
          return hasOutput2(candidate.whenTrue, visited) || hasOutput2(candidate.whenFalse, visited);
        if (ts.isBinaryExpression(candidate))
          return hasOutput2(candidate.right, visited) || (candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken || candidate.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) && hasOutput2(candidate.left, visited);
        if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))
          return collectReturnExpressions(candidate.body).some((returned) => hasOutput2(returned, visited));
        const reference = localVariableReference(candidate, context, visited);
        if (reference)
          return reference.initializers.some((initializer) => hasOutput2(initializer, reference.visitedSymbols));
        if (!ts.isIdentifier(candidate) && !ts.isPropertyAccessExpression(candidate)) return false;
        const target = targetForReference(candidate, context);
        if (target?.definition) return true;
        if (!target || !/^[A-Z]/.test(target.title.split(".").at(-1) ?? "")) return false;
        const valueType = context.checker.getTypeAtLocation(candidate);
        return valueType.getCallSignatures().length + valueType.getConstructSignatures().length > 0;
      };
      var hasOutput = hasOutput2;
      const nullish = unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
      const label = normalizedLabel(unwrapped.left.getText());
      const bindings = context.propBindings.get(ownerId);
      const hasLeftOutput = hasOutput2(unwrapped.left);
      const select = controlRuleset(
        unwrapped,
        ownerId,
        hasLeftOutput ? label : nullish ? `${label} == null` : negateLabel(label),
        ruleset,
        context,
        hasLeftOutput ? {
          // The decision is the left operand's truthiness (`??`: null or
          // not) — a two-value subject, so it renders as a switch over it,
          // same as any other boolean gate. What each arm renders is the
          // graph's business: the arm edges already point at their nodes.
          cases: [
            { id: "left", label },
            { id: "right", label: nullish ? `${label} == null` : negateLabel(label) }
          ],
          polarityPair: true
        } : void 0
      );
      if (hasLeftOutput) visit(unwrapped.left, select("left"));
      visit(unwrapped.right, select(hasLeftOutput ? "right" : "on"));
      return true;
    }
    return false;
  }
  function controlledReturns(body, ownerId, context, visit, initialRuleset = [[]]) {
    if (!ts.isBlock(body)) {
      visit(body, initialRuleset);
      return;
    }
    const statementsOf = (statement) => !statement ? [] : ts.isBlock(statement) ? statement.statements : [statement];
    function hasExit(node) {
      if (ts.isFunctionLike(node)) return false;
      if (ts.isReturnStatement(node) || ts.isBreakStatement(node) || ts.isThrowStatement(node)) return true;
      let found = false;
      ts.forEachChild(node, (child) => {
        if (hasExit(child)) found = true;
      });
      return found;
    }
    function mayRender(statements, breakContinuation = []) {
      for (const [index, statement] of statements.entries()) {
        const tail = statements.slice(index + 1);
        if (ts.isReturnStatement(statement))
          return !!statement.expression && !isEmptyOutput(statement.expression, context);
        if (ts.isBlock(statement)) return mayRender([...statement.statements, ...tail], breakContinuation);
        if (ts.isIfStatement(statement))
          return mayRender([...statementsOf(statement.thenStatement), ...tail], breakContinuation) || mayRender([...statementsOf(statement.elseStatement), ...tail], breakContinuation);
        if (ts.isSwitchStatement(statement))
          return statement.caseBlock.clauses.some((clause) => mayRender([...clause.statements, ...tail], tail));
        if (ts.isBreakStatement(statement)) return mayRender(breakContinuation);
        if (ts.isThrowStatement(statement)) return false;
      }
      return false;
    }
    function walk(statements, initial, breakContinuation = [], continuation = []) {
      let next = initial;
      let breaks = [];
      for (const [index, statement] of statements.entries()) {
        if (next.length === 0) break;
        if (ts.isReturnStatement(statement)) {
          if (statement.expression) visit(statement.expression, next);
          next = [];
        } else if (ts.isThrowStatement(statement)) {
          next = [];
        } else if (ts.isBreakStatement(statement)) {
          breaks = unionRulesets(breaks, next);
          next = [];
        } else if (ts.isBlock(statement)) {
          const flow = walk(statement.statements, next, breakContinuation, [
            ...statements.slice(index + 1),
            ...continuation
          ]);
          next = flow.next;
          breaks = unionRulesets(breaks, flow.breaks);
        } else if (ts.isIfStatement(statement) && (hasExit(statement.thenStatement) || statement.elseStatement && hasExit(statement.elseStatement))) {
          const tail = [...statements.slice(index + 1), ...continuation];
          const trueOutput = mayRender([...statementsOf(statement.thenStatement), ...tail], breakContinuation);
          const falseOutput = mayRender([...statementsOf(statement.elseStatement), ...tail], breakContinuation);
          if (!trueOutput && !falseOutput) {
            next = [];
            continue;
          }
          if (isGateCombination(statement.expression)) {
            const trueClauses = conditionClauses(statement.expression);
            const falseClauses = trueClauses && negateClauses(trueClauses);
            const trueReady = !trueOutput || trueClauses !== void 0;
            const falseReady = !falseOutput || falseClauses !== void 0;
            if (trueReady && falseReady) {
              const thenFlow2 = walk(
                statementsOf(statement.thenStatement),
                combineRulesets(next, trueOutput ? conditionRequirements(trueClauses, ownerId, next, context) : []),
                breakContinuation,
                tail
              );
              const elseFlow2 = walk(
                statementsOf(statement.elseStatement),
                combineRulesets(next, falseOutput ? conditionRequirements(falseClauses, ownerId, next, context) : []),
                breakContinuation,
                tail
              );
              next = unionRulesets(thenFlow2.next, elseFlow2.next);
              breaks = unionRulesets(breaks, thenFlow2.breaks, elseFlow2.breaks);
              continue;
            }
          }
          const label = normalizedLabel(statement.expression.getText());
          const select = controlRuleset(
            statement,
            ownerId,
            trueOutput && falseOutput ? positiveLabel(label) : trueOutput ? label : negateLabel(label),
            next,
            context,
            trueOutput && falseOutput ? {
              cases: polarityPairCases(label),
              polarityPair: true
            } : void 0
          );
          const thenFlow = walk(
            statementsOf(statement.thenStatement),
            select(trueOutput && falseOutput ? "true" : trueOutput ? "on" : "off"),
            breakContinuation,
            tail
          );
          const elseFlow = walk(
            statementsOf(statement.elseStatement),
            select(trueOutput && falseOutput ? "false" : falseOutput ? "on" : "off"),
            breakContinuation,
            tail
          );
          next = unionRulesets(thenFlow.next, elseFlow.next);
          breaks = unionRulesets(breaks, thenFlow.breaks, elseFlow.breaks);
        } else if (ts.isSwitchStatement(statement)) {
          const clauses = statement.caseBlock.clauses;
          if (clauses.length === 0) continue;
          const alternatives = clauses.map((clause, clauseIndex) => ({
            id: `case:${clauseIndex}`,
            label: ts.isCaseClause(clause) ? literalCaseText(clause.expression) : "default"
          }));
          const noDefault = !clauses.some(ts.isDefaultClause);
          if (noDefault) alternatives.push({ id: `case:${clauses.length}`, label: "default" });
          const tail = [...statements.slice(index + 1), ...continuation];
          if (alternatives.length === 1) {
            const flow = walk(clauses.at(0).statements, next, tail, tail);
            next = unionRulesets(flow.next, flow.breaks);
            continue;
          }
          const select = controlRuleset(statement, ownerId, statement.expression.getText(), next, context, {
            cases: alternatives
          });
          let fallthrough = [];
          let exits = noDefault ? select(`case:${clauses.length}`) : [];
          for (const [clauseIndex, clause] of clauses.entries()) {
            const flow = walk(clause.statements, unionRulesets(fallthrough, select(`case:${clauseIndex}`)), tail, [
              ...clauses.slice(clauseIndex + 1).flatMap((nextClause) => [...nextClause.statements]),
              ...tail
            ]);
            fallthrough = flow.next;
            exits = unionRulesets(exits, flow.breaks);
          }
          next = unionRulesets(exits, fallthrough);
        } else if (!ts.isFunctionLike(statement)) {
          for (const expression of collectReturnExpressions(statement)) visit(expression, next);
        }
      }
      return { next, breaks };
    }
    walk(body.statements, initialRuleset);
  }
  function addUseRuleset(context, useId, ruleset, rulesetsByUse = context.useRulesets) {
    rulesetsByUse.set(useId, unionRulesets(rulesetsByUse.get(useId) ?? [], ruleset));
  }
  function analyzeDefinitionUsages(definition, context) {
    const activeExpressions = /* @__PURE__ */ new Set();
    function analyzeRendered(expression, ruleset = [[]]) {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        analyzeRenderedValue(expression, ruleset);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function analyzeRenderedValue(expression, ruleset) {
      if (controlledExpression(expression, definition.id, ruleset, context, analyzeRendered)) return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeChild(child, ruleset);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, ruleset);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (!target) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, ruleset);
          return;
        }
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUseRuleset(context, use.id, ruleset);
        analyzeJsxComponentUsage(unwrapped, use, context);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child, ruleset);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (!target) return;
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUseRuleset(context, use.id, ruleset);
        analyzeCreateElementUsage(unwrapped, use, context);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element, ruleset);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            controlledReturns(argument.body, definition.id, context, analyzeRendered, ruleset);
          }
        }
        return;
      }
      const reference = localVariableReference(unwrapped, context, /* @__PURE__ */ new Set());
      if (reference) for (const initializer of reference.initializers) analyzeRendered(initializer, ruleset);
    }
    function analyzeChild(child, ruleset) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression, ruleset);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        analyzeRendered(child, ruleset);
      }
    }
    if (definition.body) controlledReturns(definition.body, definition.id, context, analyzeRendered);
    else for (const root of definition.renderRoots) analyzeRendered(root);
  }
  function resolveConsumerRoutes(receiverUse, propName, kind, rulesByComponentId, context, visited = /* @__PURE__ */ new Set()) {
    const visitKey = `${receiverUse.id}\0${propName}\0${kind}`;
    if (visited.has(visitKey)) return [];
    const nextVisited = new Set(visited).add(visitKey);
    const step = {
      useId: receiverUse.id,
      componentId: receiverUse.target.id,
      propName,
      ruleset: [[]]
    };
    const rules = rulesByComponentId.get(receiverUse.target.id);
    if (!rules) {
      if (kind === "render-prop" && /^on[A-Z]/.test(propName)) return [];
      return [{ kind, steps: [step] }];
    }
    const candidates = [
      ...rules.exact.get(propName) ?? [],
      ...rules.spreads.filter(({ excludedProps }) => !excludedProps.has(propName)).map(({ targetUseId, ruleset }) => ({
        type: "forward",
        targetUseId,
        targetPropName: propName,
        ruleset
      }))
    ];
    const routes = /* @__PURE__ */ new Map();
    for (const rule of candidates) {
      if (rule.type === "terminal") {
        if (rule.kind === kind) {
          const route = { kind, steps: [{ ...step, ruleset: rule.ruleset }] };
          routes.set(JSON.stringify(route), route);
        }
        continue;
      }
      const targetUse = context.uses.get(rule.targetUseId);
      if (!targetUse) continue;
      for (const downstream of resolveConsumerRoutes(
        targetUse,
        rule.targetPropName,
        kind,
        rulesByComponentId,
        context,
        nextVisited
      )) {
        const route = {
          kind,
          steps: [{ ...step, ruleset: rule.ruleset }, ...downstream.steps]
        };
        routes.set(JSON.stringify(route), route);
      }
    }
    return [...routes.values()];
  }
  function edgeId(relationship) {
    const key = relationship.kind === "inline-render" ? relationshipKey(relationship) : `${relationshipKey(relationship)}\0${relationship.supplierIds.join("\0")}`;
    return `edge:${createHash2("sha256").update(key).digest("hex").slice(0, 16)}`;
  }
  function sourceHref(relativePath) {
    return `source:///${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }
  function matchesComponentPattern(id, title, patterns) {
    return import_micromatch.default.match([title, id], patterns).length > 0;
  }
  function createVisibilityByTarget(definitions, externalTargets, excludeFilePatterns, excludeComponentPatterns) {
    const excludeFileRules = excludeFilePatterns.length > 0 ? (0, import_ignore2.default)().add([...excludeFilePatterns]) : void 0;
    const visibility = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      const hidden = (excludeFileRules?.ignores(definition.relativePath) ?? false) || matchesComponentPattern(definition.id, definition.name, excludeComponentPatterns);
      visibility.set(definition.id, {
        boundaryVisible: !hidden,
        implementationAnalyzed: !hidden
      });
    }
    for (const target of externalTargets.values()) {
      visibility.set(target.id, {
        boundaryVisible: !matchesComponentPattern(target.id, target.title, excludeComponentPatterns),
        implementationAnalyzed: false
      });
    }
    return visibility;
  }
  function sourceDefinitionIds(definitions, uses) {
    const definitionIds = new Set(definitions.map(({ id }) => id));
    const adjacency = new Map(definitions.map(({ id }) => [id, /* @__PURE__ */ new Set()]));
    for (const use of uses.values()) {
      if (definitionIds.has(use.ownerId) && use.target.definition) {
        adjacency.get(use.ownerId)?.add(use.target.id);
      }
    }
    let nextIndex = 0;
    const indices = /* @__PURE__ */ new Map();
    const lowLinks = /* @__PURE__ */ new Map();
    const stack = [];
    const onStack = /* @__PURE__ */ new Set();
    const components = [];
    function connect(componentId) {
      indices.set(componentId, nextIndex);
      lowLinks.set(componentId, nextIndex);
      nextIndex += 1;
      stack.push(componentId);
      onStack.add(componentId);
      for (const targetId of [...adjacency.get(componentId) ?? []].toSorted()) {
        if (!indices.has(targetId)) {
          connect(targetId);
          lowLinks.set(componentId, Math.min(lowLinks.get(componentId), lowLinks.get(targetId)));
        } else if (onStack.has(targetId)) {
          lowLinks.set(componentId, Math.min(lowLinks.get(componentId), indices.get(targetId)));
        }
      }
      if (lowLinks.get(componentId) !== indices.get(componentId)) return;
      const component = [];
      while (stack.length > 0) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === componentId) break;
      }
      components.push(component.toSorted());
    }
    for (const definition of definitions) {
      if (!indices.has(definition.id)) connect(definition.id);
    }
    const componentIndexById = /* @__PURE__ */ new Map();
    components.forEach((component, index) => {
      for (const componentId of component) componentIndexById.set(componentId, index);
    });
    const incoming = /* @__PURE__ */ new Set();
    for (const [sourceId, targetIds] of adjacency) {
      const sourceIndex = componentIndexById.get(sourceId);
      for (const targetId of targetIds) {
        const targetIndex = componentIndexById.get(targetId);
        if (sourceIndex !== void 0 && targetIndex !== void 0 && sourceIndex !== targetIndex)
          incoming.add(targetIndex);
      }
    }
    return components.filter((_, index) => !incoming.has(index)).flat().toSorted();
  }
  function collapseComponentStructure(definitions, context, rulesByComponentId, visibility) {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const visibleInstances = /* @__PURE__ */ new Map();
    const visibleDefinitionIds = /* @__PURE__ */ new Set();
    const relationships = /* @__PURE__ */ new Map();
    const controls = /* @__PURE__ */ new Map();
    const roots = [];
    function instantiateRuleset(ruleset, instance, source, prerequisites = [[]]) {
      return ruleset.map(
        (path) => path.map(({ controlId, value }) => {
          const template = context.controls.get(controlId);
          const id = `${instance.id}:control:${controlId.split(":control:").at(-1)}`;
          const when = combineRulesets(
            prerequisites,
            instantiateRuleset(template.dependsOn, instance, source, prerequisites)
          );
          const existing = controls.get(id);
          controls.set(id, {
            ...template,
            id,
            owner: source.id,
            dependsOn: unionRulesets(existing?.dependsOn ?? [], when)
          });
          return { controlId: id, value };
        })
      );
    }
    function targetVisibility(targetId) {
      return visibility.get(targetId) ?? { boundaryVisible: false, implementationAnalyzed: false };
    }
    function createInstance(id, target, owner) {
      const ancestors = new Map(owner?.ancestors);
      const instance = { id, target, ancestors, uses: /* @__PURE__ */ new Map() };
      ancestors.set(target.id, instance);
      return instance;
    }
    function ensureComponentInstance(parent, use, owner) {
      const existing = parent.uses.get(use.id);
      if (existing) return existing;
      const ancestor = owner.ancestors.get(use.target.id);
      const suffix = createHash2("sha256").update(`${parent.id}\0${use.id}`).digest("hex").slice(0, 16);
      const instance = ancestor ?? createInstance(`${use.target.id}@${suffix}`, use.target, owner);
      parent.uses.set(use.id, instance);
      return instance;
    }
    function addFinalRelationship(relationship) {
      const key = relationshipKey(relationship);
      const existing = relationships.get(key);
      if (!existing) {
        relationships.set(key, relationship);
        return;
      }
      const ruleset = unionRulesets(existing.ruleset, relationship.ruleset);
      relationships.set(
        key,
        existing.kind === "inline-render" || relationship.kind === "inline-render" ? { ...relationship, ruleset } : {
          ...relationship,
          ruleset,
          supplierIds: [.../* @__PURE__ */ new Set([...existing.supplierIds, ...relationship.supplierIds])].toSorted(),
          supplierInstanceIds: [
            .../* @__PURE__ */ new Set([...existing.supplierInstanceIds, ...relationship.supplierInstanceIds])
          ].toSorted(),
          origins: [
            ...new Map(
              [...existing.origins, ...relationship.origins].map((origin) => [JSON.stringify(origin), origin])
            ).values()
          ]
        }
      );
    }
    function makeVisible(instance) {
      const policy = targetVisibility(instance.target.id);
      if (!policy.boundaryVisible || visibleInstances.has(instance.id)) return;
      visibleInstances.set(instance.id, instance);
      visibleDefinitionIds.add(instance.target.id);
      if (!instance.target.definition || !policy.implementationAnalyzed) return;
      for (const useId of context.directUseIdsByOwner.get(instance.target.id) ?? []) {
        const use = context.uses.get(useId);
        if (use) processDirectUse(instance, use);
      }
    }
    function processSuppliedTarget(targetUse, parent, source, owner, kind, propName, originPropName, trail, ruleset, targetUseRuleset) {
      const visitKey = [targetUse.id, source.id, kind, propName].join("\0");
      if (trail.has(visitKey)) return;
      const nextTrail = new Set(trail).add(visitKey);
      const instance = ensureComponentInstance(parent, targetUse, owner);
      const policy = targetVisibility(targetUse.target.id);
      const supplierSource = targetVisibility(owner.target.id).boundaryVisible ? owner : source;
      const targetRulesets = combineRulesets(instantiateRuleset(targetUseRuleset, owner, supplierSource), ruleset);
      if (!policy.boundaryVisible) {
        processUseSupplies(targetUse, instance, source, owner, nextTrail, { kind, propName }, targetRulesets);
        return;
      }
      makeVisible(instance);
      addFinalRelationship({
        source: source.id,
        target: instance.id,
        kind,
        propName,
        supplierIds: [targetUse.ownerId],
        supplierInstanceIds: [owner.id],
        origins: [{ supplierId: targetUse.ownerId, prop: originPropName }],
        ruleset: targetRulesets
      });
      processUseSupplies(targetUse, instance, instance, owner, nextTrail);
    }
    function processUseSupplies(receiverUse, receiver, fallbackSource, owner, trail = /* @__PURE__ */ new Set(), inherited, inheritedRulesets = [[]]) {
      const receiverVisible = targetVisibility(receiverUse.target.id).boundaryVisible;
      for (const supplied of receiverUse.suppliedValues) {
        const routes = resolveConsumerRoutes(
          receiverUse,
          supplied.propName,
          supplied.kind,
          rulesByComponentId,
          context
        );
        if (routes.length === 0) continue;
        for (const route of routes) {
          let consumer = receiver;
          let source = fallbackSource;
          let propName = inherited?.propName ?? supplied.propName;
          let visiblePath = receiverVisible;
          let routeRulesets = inheritedRulesets;
          for (const [index, step] of route.steps.entries()) {
            if (index > 0) {
              const use = context.uses.get(step.useId);
              consumer = ensureComponentInstance(consumer, use, consumer);
            }
            visiblePath &&= targetVisibility(step.componentId).boundaryVisible;
            if (visiblePath) {
              source = consumer;
              propName = step.propName;
            }
            routeRulesets = combineRulesets(
              routeRulesets,
              instantiateRuleset(step.ruleset, consumer, source, routeRulesets)
            );
          }
          for (const suppliedTarget of supplied.targets) {
            const targetUse = context.uses.get(suppliedTarget.useId);
            if (targetUse) {
              processSuppliedTarget(
                targetUse,
                consumer,
                source,
                owner,
                inherited?.kind ?? route.kind,
                propName,
                supplied.propName,
                trail,
                routeRulesets,
                suppliedTarget.ruleset
              );
            }
          }
        }
      }
    }
    function processDirectUse(source, use) {
      const instance = ensureComponentInstance(source, use, source);
      const policy = targetVisibility(use.target.id);
      const ruleset = instantiateRuleset(context.useRulesets.get(use.id) ?? [[]], source, source);
      if (policy.boundaryVisible) {
        makeVisible(instance);
        addFinalRelationship({ source: source.id, target: instance.id, kind: "inline-render", ruleset });
      }
      processUseSupplies(use, instance, source, source, /* @__PURE__ */ new Set(), void 0, policy.boundaryVisible ? [[]] : ruleset);
    }
    for (const rootId of sourceDefinitionIds(definitions, context.uses)) {
      const definition = definitionsById.get(rootId);
      if (!definition || visibleDefinitionIds.has(rootId) || !targetVisibility(rootId).boundaryVisible) continue;
      roots.push(rootId);
      makeVisible(createInstance(rootId, { id: definition.id, title: definition.name, definition }));
    }
    return {
      instances: [...visibleInstances.values()],
      controls: [...controls.values()],
      roots,
      relationships: [...relationships.values()].toSorted(
        (left, right) => relationshipKey(left).localeCompare(relationshipKey(right))
      )
    };
  }
  function createGraph(definitions, instances, relationships, controls, roots) {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    function componentMetadata(id, definitionId) {
      const origins = relationships.flatMap(
        (relationship) => relationship.target === id && relationship.kind !== "inline-render" ? relationship.origins.map(({ supplierId, prop }) => ({
          supplierId,
          supplierTitle: definitionsById.get(supplierId)?.name ?? supplierId,
          prop
        })) : []
      );
      return {
        definitionId,
        origins: [...new Map(origins.map((origin) => [JSON.stringify(origin), origin])).values()]
      };
    }
    const localNodes = instances.flatMap(({ id, target }) => {
      const definition = target.definition;
      return definition ? [
        {
          type: "default",
          id,
          title: definition.name,
          description: definition.relativePath,
          links: [{ href: sourceHref(definition.relativePath) }],
          component: componentMetadata(id, target.id)
        }
      ] : [];
    });
    if (localNodes.length === 0) throw new Error("No React component definitions remain after filtering.");
    const externalNodes = instances.filter(({ target }) => !target.definition).map(({ id, target }) => ({
      type: "default",
      id,
      title: target.title,
      description: `${target.externalPackage} boundary`,
      component: componentMetadata(id, target.id)
    }));
    const candidateNodeIds = new Set([...localNodes, ...externalNodes].map(({ id }) => id));
    const edges = relationships.filter(({ source, target }) => candidateNodeIds.has(source) && candidateNodeIds.has(target)).map((relationship) => ({
      type: "default",
      id: edgeId(relationship),
      source: relationship.source,
      target: relationship.target,
      activeWhen: relationship.ruleset
    })).toSorted((left, right) => left.id.localeCompare(right.id));
    const nodes = [...localNodes, ...externalNodes].toSorted((left, right) => left.id.localeCompare(right.id));
    return { groups: [], nodes, edges, roots, controls };
  }
  function focusGraphOnRoots(graph, rootPatterns, instances) {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const roots = graph.nodes.filter(
      ({ id, title }) => rootPatterns.some(
        (pattern) => matchesComponentPattern(targetsByInstanceId.get(id).id, title, [pattern]) || matchesComponentPattern(id, title, [pattern])
      )
    );
    if (roots.length === 0) {
      throw new Error(`No visible component matches the --root pattern: ${rootPatterns.join(", ")}`);
    }
    const reachable = new Set(roots.map(({ id }) => id));
    const targetsBySource = /* @__PURE__ */ new Map();
    for (const { source, target } of graph.edges) {
      targetsBySource.set(source, [...targetsBySource.get(source) ?? [], target]);
    }
    const queue = [...reachable];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const target of targetsBySource.get(current) ?? []) {
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
    return {
      ...graph,
      nodes: graph.nodes.filter(({ id }) => reachable.has(id)),
      edges: graph.edges.filter(({ source, target }) => reachable.has(source) && reachable.has(target)),
      roots: roots.map(({ id }) => id),
      controls: graph.controls
    };
  }
  function toStoredGraph(graph) {
    return {
      groups: graph.groups,
      nodes: graph.nodes,
      edges: graph.edges.map((edge) => {
        const ruleset = edge.activeWhen ?? [[]];
        return ruleset.length === 1 && ruleset.at(0)?.length === 0 ? { type: "default", id: edge.id, source: edge.source, target: edge.target } : { type: "control", id: edge.id, source: edge.source, target: edge.target, activeWhen: ruleset };
      }),
      additional: { roots: graph.roots, controls: graph.controls }
    };
  }
  function mergePolarityConditionals(context, rulesByComponentId) {
    const parsedLabels = /* @__PURE__ */ new Map();
    const parseLabel = (label) => {
      if (!parsedLabels.has(label)) {
        const sourceFile = ts.createSourceFile("label.ts", label, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const [statement] = sourceFile.statements;
        parsedLabels.set(label, ts.isExpressionStatement(statement) ? statement.expression : void 0);
      }
      return parsedLabels.get(label);
    };
    const structureKey = (node) => {
      if (ts.isParenthesizedExpression(node)) return structureKey(node.expression);
      if (ts.isIdentifier(node)) return `id\0${node.text}`;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return `lit\0${node.text}`;
      if (ts.isNumericLiteral(node)) return `lit\0${node.text}`;
      if (ts.isPropertyAccessExpression(node)) return `get\0${structureKey(node.expression)}\0${node.name.text}`;
      if (ts.isElementAccessExpression(node))
        return `at\0${structureKey(node.expression)}\0${node.argumentExpression.getText()}`;
      if (ts.isCallExpression(node))
        return `call\0${structureKey(node.expression)}\0${node.arguments.map(structureKey).join("")}`;
      if (ts.isPrefixUnaryExpression(node)) return `pre\0${node.operator}\0${structureKey(node.operand)}`;
      if (ts.isBinaryExpression(node))
        return `bin\0${node.operatorToken.kind}\0${structureKey(node.left)}\0${structureKey(node.right)}`;
      return `raw\0${node.kind}\0${node.getText()}`;
    };
    const unwrapPolarity = (node) => {
      let core = node;
      let parity = 0;
      for (; ; ) {
        if (ts.isParenthesizedExpression(core)) {
          core = core.expression;
          continue;
        }
        if (ts.isPrefixUnaryExpression(core) && core.operator === ts.SyntaxKind.ExclamationToken) {
          parity ^= 1;
          core = core.operand;
          continue;
        }
        return { core, parity };
      }
    };
    const isEnumSubject = (node) => ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) && isEnumSubject(node.expression);
    const isEnumLiteral = (node) => ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
    const polarityOfLabel = (text) => {
      const expression = parseLabel(text);
      if (!expression) return void 0;
      const { core, parity } = unwrapPolarity(expression);
      if (!ts.isBinaryExpression(core) || !COMPLEMENTARY_OPERATORS[core.operatorToken.kind])
        return { group: `expression\0${structureKey(core)}`, caseKey: `polarity:${parity}`, positive: parity === 0 };
      const operator = COMPLEMENTARY_OPERATORS[core.operatorToken.kind];
      const leftCore = unwrapPolarity(core.left).core;
      const rightCore = unwrapPolarity(core.right).core;
      const left = leftCore.getText();
      const right = rightCore.getText();
      const polarity = parity ^ (operator.inverted ? 1 : 0);
      return {
        group: `comparison\0${operator.family}\0${structureKey(leftCore)}\0${structureKey(rightCore)}`,
        caseKey: `polarity:${polarity}`,
        positive: polarity === 0,
        ...parity === 0 && !operator.inverted && isEnumSubject(leftCore) && isEnumLiteral(rightCore) ? { enumSubject: left, enumCase: right } : {}
      };
    };
    const polarityOf = (control) => polarityOfLabel(control.label);
    const branchCasesOf = (control) => {
      if (control.kind !== "branch" || control.cases.length !== 2) return void 0;
      const [trueCase, falseCase] = control.cases;
      if (!trueCase || !falseCase || trueCase.id !== "true" || falseCase.id !== "false") return void 0;
      return { trueText: trueCase.label, falseText: falseCase.label };
    };
    const groups = /* @__PURE__ */ new Map();
    const EQUALITY_FAMILIES = /* @__PURE__ */ new Set(["equal", "loosely-equal"]);
    const discriminantOf = (control) => {
      let label;
      let values;
      if (control.kind === "branch") {
        const [onCase, offCase] = control.cases;
        if (control.cases.length !== 2 || onCase?.id !== "true" || offCase?.id !== "false" || offCase.label !== negateLabel(onCase.label))
          return void 0;
        label = onCase.label;
        values = ["true", "false"];
      } else {
        label = control.label;
        values = ["on", "off"];
      }
      const expression = parseLabel(label);
      if (!expression) return void 0;
      const { core, parity } = unwrapPolarity(expression);
      if (!ts.isBinaryExpression(core)) return void 0;
      const operator = COMPLEMENTARY_OPERATORS[core.operatorToken.kind];
      if (!operator || !EQUALITY_FAMILIES.has(operator.family)) return void 0;
      const left = unwrapPolarity(core.left).core;
      const right = unwrapPolarity(core.right).core;
      if (!isEnumSubject(left) || !isEnumLiteral(right)) return void 0;
      const literal = literalCaseText(right);
      if (literal.length === 0) return void 0;
      const positive = operator.inverted ? parity === 1 : parity === 0;
      const semantics = new Map(
        values.map((value, index) => [value, { literal, positive: index === 0 ? positive : !positive }])
      );
      return {
        control,
        groupKey: `${control.owner}\0discriminant\0${operator.family}\0${structureKey(left)}`,
        subject: left.getText(),
        semantics
      };
    };
    const discriminantMembers = /* @__PURE__ */ new Map();
    const discriminantGroups = /* @__PURE__ */ new Map();
    for (const control of context.controls.values()) {
      const member = discriminantOf(control);
      if (!member) continue;
      discriminantMembers.set(control.id, member);
      const group = discriminantGroups.get(member.groupKey) ?? {
        owner: member.control.owner,
        subject: member.subject,
        members: [],
        positiveLiterals: [],
        needsRemainder: false,
        representative: member.control,
        staysConditional: false
      };
      group.members.push(member);
      for (const { literal, positive } of member.semantics.values()) {
        if (positive && !group.positiveLiterals.includes(literal)) group.positiveLiterals.push(literal);
      }
      discriminantGroups.set(member.groupKey, group);
    }
    for (const control of context.controls.values()) {
      if (discriminantMembers.has(control.id)) continue;
      const branchCases = branchCasesOf(control);
      if (!branchCases && control.kind !== "conditional") continue;
      const polarity = branchCases ? polarityOfLabel(branchCases.trueText) : polarityOf(control);
      if (!polarity) continue;
      const key = `${control.owner}\0${polarity.group}`;
      const members = groups.get(key) ?? [];
      members.push({ control, polarity, ...branchCases ? { branchCases } : {} });
      groups.set(key, members);
    }
    const scanDiscriminantUsage = (ruleset) => {
      for (const rule of ruleset) {
        const states = /* @__PURE__ */ new Map();
        for (const { controlId, value } of rule) {
          const member = discriminantMembers.get(controlId);
          const semantic = member?.semantics.get(value);
          if (!member || !semantic) continue;
          const state = states.get(member.groupKey) ?? { positives: /* @__PURE__ */ new Set(), negatives: /* @__PURE__ */ new Set() };
          (semantic.positive ? state.positives : state.negatives).add(semantic.literal);
          states.set(member.groupKey, state);
        }
        for (const [groupKey, { positives, negatives }] of states) {
          if (positives.size > 0 || negatives.size === 0) continue;
          const group = discriminantGroups.get(groupKey);
          if (group.positiveLiterals.length > 0) group.needsRemainder = true;
        }
      }
    };
    for (const control of context.controls.values()) scanDiscriminantUsage(control.dependsOn);
    for (const ruleset of context.useRulesets.values()) scanDiscriminantUsage(ruleset);
    for (const use of context.uses.values()) {
      for (const supplied of use.suppliedValues) {
        for (const target of supplied.targets) scanDiscriminantUsage(target.ruleset);
      }
    }
    for (const rules of rulesByComponentId.values()) {
      for (const list of rules.exact.values()) for (const rule of list) scanDiscriminantUsage(rule.ruleset);
      for (const spread of rules.spreads) scanDiscriminantUsage(spread.ruleset);
    }
    for (const group of discriminantGroups.values()) {
      group.staysConditional = group.positiveLiterals.length < 2 && !group.needsRemainder;
    }
    const finalGroups = [...groups.values()];
    const replacements = /* @__PURE__ */ new Map();
    const memberIds = /* @__PURE__ */ new Set();
    const mergedGroups = /* @__PURE__ */ new Map();
    const complementKeyOf = (caseKey) => caseKey.startsWith("polarity:") ? `polarity:${caseKey === "polarity:0" ? 1 : 0}` : caseKey;
    for (const members of finalGroups) {
      if (members.length === 1 && members.at(0).branchCases) continue;
      const representative = members.at(0).control;
      const caseTextByKey = /* @__PURE__ */ new Map();
      for (const { control, polarity, branchCases } of members) {
        if (!caseTextByKey.has(polarity.caseKey))
          caseTextByKey.set(polarity.caseKey, branchCases ? branchCases.trueText : control.label);
        if (branchCases && !caseTextByKey.has(complementKeyOf(polarity.caseKey)))
          caseTextByKey.set(complementKeyOf(polarity.caseKey), branchCases.falseText);
        memberIds.add(control.id);
      }
      const complementText = (caseKey) => caseTextByKey.get(complementKeyOf(caseKey));
      const staysConditional = caseTextByKey.size < 2;
      for (const { control, polarity, branchCases } of members) {
        const values = branchCases ? {
          true: caseTextByKey.get(polarity.caseKey),
          false: caseTextByKey.get(complementKeyOf(polarity.caseKey))
        } : staysConditional ? { on: "on", off: "off" } : {
          on: caseTextByKey.get(polarity.caseKey),
          ...complementText(polarity.caseKey) ? { off: complementText(polarity.caseKey) } : {}
        };
        replacements.set(control.id, { controlId: representative.id, values });
      }
      mergedGroups.set(representative.id, members);
    }
    const discriminantByRepresentative = /* @__PURE__ */ new Map();
    for (const group of discriminantGroups.values()) {
      discriminantByRepresentative.set(group.representative.id, group);
      for (const { control } of group.members) memberIds.add(control.id);
    }
    const conditionalValueOf = (group, outcomePositive) => {
      const representative = group.members.at(0).semantics;
      const onSemantic = representative.get("on") ?? representative.get("true");
      return onSemantic.positive === outcomePositive ? "on" : "off";
    };
    const resolveDiscriminant = (group, positives, negatives) => {
      const [chosen] = positives;
      if (chosen !== void 0) {
        if (negatives.has(chosen)) return [];
        return group.staysConditional ? [conditionalValueOf(group, true)] : group.positiveLiterals.includes(chosen) ? [chosen] : [];
      }
      if (negatives.size === 0) return [];
      if (group.staysConditional) return [conditionalValueOf(group, false)];
      const allowed = group.positiveLiterals.filter((literal) => !negatives.has(literal));
      return group.needsRemainder ? [...allowed, "otherwise"] : allowed;
    };
    const rewrite = (ruleset) => {
      const rewritten = [];
      for (const rule of ruleset) {
        const slots = [];
        const states = /* @__PURE__ */ new Map();
        let dead = false;
        for (const requirement of rule) {
          const member = discriminantMembers.get(requirement.controlId);
          if (member) {
            const semantic = member.semantics.get(requirement.value);
            if (!semantic) {
              dead = true;
              break;
            }
            const state = states.get(member.groupKey) ?? { positives: /* @__PURE__ */ new Set(), negatives: /* @__PURE__ */ new Set() };
            (semantic.positive ? state.positives : state.negatives).add(semantic.literal);
            if (!states.has(member.groupKey)) {
              states.set(member.groupKey, state);
              slots.push({ groupKey: member.groupKey, state });
            }
            continue;
          }
          const replacement = replacements.get(requirement.controlId);
          if (!replacement) {
            slots.push({ requirement });
            continue;
          }
          const value = replacement.values[requirement.value];
          slots.push({ requirement: value === void 0 ? requirement : { controlId: replacement.controlId, value } });
        }
        if (dead) continue;
        const buildRules = (index, base) => {
          if (index >= slots.length) return [base];
          const slot = slots[index];
          if ("requirement" in slot) return buildRules(index + 1, [...base, slot.requirement]);
          const group = discriminantGroups.get(slot.groupKey);
          const values = resolveDiscriminant(group, slot.state.positives, slot.state.negatives);
          return values.flatMap(
            (value) => buildRules(index + 1, [...base, { controlId: group.representative.id, value }])
          );
        };
        rewritten.push(...buildRules(0, []));
      }
      return rewritten;
    };
    const controls = /* @__PURE__ */ new Map();
    for (const control of context.controls.values()) {
      const members = mergedGroups.get(control.id);
      if (members) {
        const casesByKey = /* @__PURE__ */ new Map();
        for (const { control: member, polarity, branchCases } of members) {
          if (!casesByKey.has(polarity.caseKey))
            casesByKey.set(polarity.caseKey, {
              id: branchCases ? branchCases.trueText : member.label,
              label: branchCases ? branchCases.trueText : member.label,
              positive: polarity.positive
            });
          if (branchCases && !casesByKey.has(complementKeyOf(polarity.caseKey)))
            casesByKey.set(complementKeyOf(polarity.caseKey), {
              id: branchCases.falseText,
              label: branchCases.falseText,
              positive: !polarity.positive
            });
        }
        const ordered = [...casesByKey.values()];
        const positiveCase = ordered.find(({ positive }) => positive);
        if (ordered.length === 2 && positiveCase && ordered.at(0) !== positiveCase) ordered.reverse();
        const cases = ordered.map(({ id, label }) => ({ id, label }));
        const positiveText = positiveCase?.label ?? ordered.at(0).label;
        controls.set(control.id, {
          id: control.id,
          owner: control.owner,
          // A two-case group is a switch over one two-value subject, so its
          // label is the positive form; a lone member stays a conditional and
          // keeps its own polarity — its label names the condition that turns
          // it on. Comparison groups qualify too: they pair one predicate with
          // its complement over the same threshold, which never overlaps —
          // overlapping thresholds keep separate groups (ADR 0005 category 6).
          ...cases.length >= 2 ? {
            kind: "branch",
            label: positiveLabel(positiveText),
            cases,
            polarityPair: true
          } : { kind: "conditional", label: positiveText },
          dependsOn: unionRulesets(...members.map(({ control: member }) => rewrite(member.dependsOn)))
        });
        continue;
      }
      const discriminant = discriminantByRepresentative.get(control.id);
      if (discriminant) {
        const dependsOn = unionRulesets(
          ...discriminant.members.map(({ control: member }) => rewrite(member.dependsOn))
        );
        controls.set(
          control.id,
          discriminant.staysConditional ? { id: control.id, owner: control.owner, label: control.label, kind: "conditional", dependsOn } : {
            id: control.id,
            owner: control.owner,
            kind: "branch",
            label: discriminant.subject,
            cases: [
              ...discriminant.positiveLiterals.map((literal) => ({ id: literal, label: literal })),
              ...discriminant.needsRemainder ? [{ id: "otherwise", label: "otherwise" }] : []
            ],
            dependsOn
          }
        );
        continue;
      }
      if (memberIds.has(control.id)) continue;
      controls.set(control.id, { ...control, dependsOn: rewrite(control.dependsOn) });
    }
    const creationOrder = new Map([...controls.keys()].map((id, index) => [id, index]));
    const dependents = (control) => [
      ...new Set(control.dependsOn.flat().map(({ controlId }) => controlId))
    ];
    for (; ; ) {
      const state = /* @__PURE__ */ new Map();
      const path = [];
      const visit = (id) => {
        state.set(id, "visiting");
        path.push(id);
        for (const successor2 of dependents(controls.get(id))) {
          if (!controls.has(successor2)) continue;
          if (state.get(successor2) === "visiting") return [...path.slice(path.indexOf(successor2)), successor2];
          if (!state.has(successor2)) {
            const cycle2 = visit(successor2);
            if (cycle2) return cycle2;
          }
        }
        state.set(id, "done");
        path.pop();
        return void 0;
      };
      let cycle;
      for (const id of controls.keys()) {
        if (!state.has(id)) {
          cycle = visit(id);
          if (cycle) break;
        }
      }
      if (!cycle) break;
      const ring = cycle.slice(0, -1);
      const latest = ring.reduce(
        (left, right) => creationOrder.get(left) > creationOrder.get(right) ? left : right
      );
      const successor = ring[(ring.indexOf(latest) + 1) % ring.length];
      const control = controls.get(latest);
      controls.set(latest, {
        ...control,
        dependsOn: control.dependsOn.map((rule) => rule.filter(({ controlId }) => controlId !== successor))
      });
    }
    context.controls.clear();
    for (const [id, control] of controls) context.controls.set(id, control);
    for (const [useId, ruleset] of context.useRulesets) context.useRulesets.set(useId, rewrite(ruleset));
    for (const [useId, use] of context.uses) {
      context.uses.set(useId, {
        ...use,
        suppliedValues: use.suppliedValues.map((supplied) => ({
          ...supplied,
          targets: supplied.targets.map((target) => ({ ...target, ruleset: rewrite(target.ruleset) }))
        }))
      });
    }
    for (const [componentId, rules] of rulesByComponentId) {
      rulesByComponentId.set(componentId, {
        exact: new Map(
          [...rules.exact].map(([propName, list]) => [
            propName,
            list.map((rule) => ({ ...rule, ruleset: rewrite(rule.ruleset) }))
          ])
        ),
        spreads: rules.spreads.map((spread) => ({ ...spread, ruleset: rewrite(spread.ruleset) }))
      });
    }
  }
  function mergeEquivalentContexts(graph, instances, relationships) {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const relationshipsByEdgeId = new Map(relationships.map((relationship) => [edgeId(relationship), relationship]));
    const edgesBySource = /* @__PURE__ */ new Map();
    for (const edge of graph.edges) {
      const edges2 = edgesBySource.get(edge.source) ?? [];
      edges2.push(edge);
      edgesBySource.set(edge.source, edges2);
    }
    const visibleIds = new Set(graph.nodes.map(({ id }) => id));
    const availableControls = new Map(
      graph.controls.filter(({ owner }) => visibleIds.has(owner)).map((control) => [control.id, control])
    );
    const neededControls = /* @__PURE__ */ new Set();
    function requireControls(ruleset) {
      for (const { controlId } of ruleset.flat()) {
        const control = availableControls.get(controlId);
        if (!control || neededControls.has(controlId)) continue;
        neededControls.add(controlId);
        requireControls(control.dependsOn);
      }
    }
    for (const edge of graph.edges) if (edge.type === "default") requireControls(edge.activeWhen ?? [[]]);
    const controls = graph.controls.filter(({ id }) => neededControls.has(id));
    const controlsByOwner = /* @__PURE__ */ new Map();
    const controlKeys = /* @__PURE__ */ new Map();
    for (const control of controls) {
      const owned = controlsByOwner.get(control.owner) ?? [];
      controlKeys.set(control.id, String(owned.length));
      owned.push(control);
      controlsByOwner.set(control.owner, owned);
    }
    const controlsById = new Map(controls.map((control) => [control.id, control]));
    const normalizeRulesets = (ruleset, classes2) => ruleset.map(
      (path) => path.filter(({ controlId }) => controlsById.has(controlId)).map(({ controlId, value }) => ({
        controlId: `${classes2.get(controlsById.get(controlId).owner)}:${controlKeys.get(controlId)}`,
        value
      }))
    );
    let classes = new Map(graph.nodes.map(({ id }) => [id, targetsByInstanceId.get(id).id]));
    for (; ; ) {
      const representatives = /* @__PURE__ */ new Map();
      const refined = /* @__PURE__ */ new Map();
      for (const node of graph.nodes) {
        const outgoing = (edgesBySource.get(node.id) ?? []).map((edge) => {
          const { id, source: _source, target, ...metadata } = edge;
          const relationship = relationshipsByEdgeId.get(id);
          const suppliers = relationship.kind === "inline-render" ? [] : relationship.supplierInstanceIds.map((instanceId) => classes.get(instanceId) ?? instanceId).toSorted();
          return JSON.stringify([
            {
              ...metadata,
              activeWhen: normalizeRulesets(edge.type === "default" ? edge.activeWhen ?? [[]] : [[]], classes)
            },
            suppliers,
            classes.get(target)
          ]);
        });
        const ownedControls = (controlsByOwner.get(node.id) ?? []).map(
          ({ id: _id, owner: _owner, dependsOn, ...metadata }) => ({
            ...metadata,
            dependsOn: normalizeRulesets(dependsOn, classes)
          })
        );
        const signature = JSON.stringify([classes.get(node.id), ownedControls, [...new Set(outgoing)].toSorted()]);
        if (!representatives.has(signature)) representatives.set(signature, node.id);
        refined.set(node.id, representatives.get(signature));
      }
      if (graph.nodes.every(({ id }) => refined.get(id) === classes.get(id))) break;
      classes = refined;
    }
    const classesByDefinition = /* @__PURE__ */ new Map();
    for (const node of graph.nodes) {
      const definitionId = targetsByInstanceId.get(node.id).id;
      const contexts = classesByDefinition.get(definitionId) ?? /* @__PURE__ */ new Set();
      contexts.add(classes.get(node.id));
      classesByDefinition.set(definitionId, contexts);
    }
    const outputIds = new Map(
      graph.nodes.map(({ id }) => {
        const definitionId = targetsByInstanceId.get(id).id;
        return [id, classesByDefinition.get(definitionId).size === 1 ? definitionId : classes.get(id)];
      })
    );
    const nodes = graph.nodes.filter(({ id }) => classes.get(id) === id).map((node) => {
      if (node.type !== "default") return { ...node, id: outputIds.get(node.id) };
      const origins = graph.nodes.flatMap(
        (candidate) => candidate.type === "default" && classes.get(candidate.id) === node.id ? candidate.component.origins : []
      );
      return {
        ...node,
        id: outputIds.get(node.id),
        component: {
          ...node.component,
          origins: [...new Map(origins.map((origin) => [JSON.stringify(origin), origin])).values()]
        }
      };
    }).toSorted((left, right) => left.id.localeCompare(right.id));
    const outputControlIds = new Map(
      controls.map((control) => [control.id, `${outputIds.get(control.owner)}:control:${controlKeys.get(control.id)}`])
    );
    const rewriteRulesets = (ruleset) => unionRulesets(
      ruleset.map(
        (path) => path.filter(({ controlId }) => outputControlIds.has(controlId)).map(({ controlId, value }) => ({ controlId: outputControlIds.get(controlId), value }))
      )
    );
    const outputControls = /* @__PURE__ */ new Map();
    for (const control of controls) {
      const id = outputControlIds.get(control.id);
      const existing = outputControls.get(id);
      outputControls.set(id, {
        ...control,
        id,
        owner: outputIds.get(control.owner),
        dependsOn: unionRulesets(existing?.dependsOn ?? [], rewriteRulesets(control.dependsOn))
      });
    }
    const edges = /* @__PURE__ */ new Map();
    for (const edge of graph.edges) {
      const source = outputIds.get(edge.source);
      const target = outputIds.get(edge.target);
      const id = edgeId({ ...relationshipsByEdgeId.get(edge.id), source, target });
      const existing = edges.get(id);
      const ruleset = edge.type === "default" ? rewriteRulesets(edge.activeWhen ?? [[]]) : [[]];
      edges.set(id, {
        ...edge,
        id,
        source,
        target,
        ...edge.type === "default" ? { activeWhen: unionRulesets(existing?.type === "default" ? existing.activeWhen ?? [] : [], ruleset) } : {}
      });
    }
    return {
      ...graph,
      nodes,
      edges: [...edges.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
      roots: [...new Set(graph.roots.map((id) => outputIds.get(id)))],
      controls: [...outputControls.values()]
    };
  }
  async function buildComponentGraph2(options) {
    const scopePath = options.scopePath;
    const sourceFilePaths = await collectSourceFiles(scopePath, options.sourcePaths);
    if (sourceFilePaths.length === 0)
      throw new Error("No JS, JSX, TS, or TSX source files matched the selected ruleset.");
    const compilerOptions = await readCompilerOptions(scopePath, options.tsconfigPath);
    const host = ts.createCompilerHost(compilerOptions);
    host.getCurrentDirectory = () => scopePath;
    const program = ts.createProgram({
      rootNames: sourceFilePaths,
      options: compilerOptions,
      host
    });
    const programErrors = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (programErrors.length > 0) {
      throw new Error(`Cannot initialize TypeScript analysis: ${programErrors.map(formatDiagnostic).join("\n")}`);
    }
    const selectedRulesets = new Set(sourceFilePaths);
    const sourceFiles = program.getSourceFiles().filter((sourceFile) => selectedRulesets.has(resolve3(sourceFile.fileName))).toSorted((left, right) => left.fileName.localeCompare(right.fileName));
    const syntaxErrors = sourceFiles.flatMap((sourceFile) => program.getSyntacticDiagnostics(sourceFile));
    if (syntaxErrors.length > 0) {
      throw new Error(`Cannot analyze selected source: ${syntaxErrors.map(formatDiagnostic).join("\n")}`);
    }
    const checker = program.getTypeChecker();
    const definitions = collectComponentDefinitions(sourceFiles, scopePath, checker);
    const definitionsBySymbol = /* @__PURE__ */ new Map();
    const definitionsByDeclaration = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      definitionsByDeclaration.set(definition.declaration, definition);
      const symbol = canonicalSymbol(definition.symbol, checker);
      if (symbol) definitionsBySymbol.set(symbol, definition);
    }
    const context = {
      scopePath,
      program,
      host,
      checker,
      definitionsBySymbol,
      definitionsByDeclaration,
      externalTargets: /* @__PURE__ */ new Map(),
      uses: /* @__PURE__ */ new Map(),
      directUseIdsByOwner: /* @__PURE__ */ new Map(),
      analyzedUseIds: /* @__PURE__ */ new Set(),
      controls: /* @__PURE__ */ new Map(),
      useRulesets: /* @__PURE__ */ new Map(),
      propBindings: new Map(definitions.map((definition) => [definition.id, createPropBindings(definition, checker)]))
    };
    for (const definition of definitions) analyzeDefinitionUsages(definition, context);
    const rulesByComponentId = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      const bindings = context.propBindings.get(definition.id);
      rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
    }
    mergePolarityConditionals(context, rulesByComponentId);
    const visibility = createVisibilityByTarget(
      definitions,
      context.externalTargets,
      options.excludeFilePatterns ?? [],
      options.excludeComponentPatterns ?? []
    );
    const collapsed = collapseComponentStructure(definitions, context, rulesByComponentId, visibility);
    const graph = createGraph(
      definitions,
      collapsed.instances,
      collapsed.relationships,
      collapsed.controls,
      collapsed.roots
    );
    const focused = options.rootPatterns && options.rootPatterns.length > 0 ? focusGraphOnRoots(graph, [...options.rootPatterns], collapsed.instances) : graph;
    return toStoredGraph(mergeEquivalentContexts(focused, collapsed.instances, collapsed.relationships));
  }
  return buildComponentGraph2;
}
async function buildComponentGraph(options) {
  if (options.sourcePaths.length === 0) throw new Error("At least one source path is required.");
  const scopePath = await realpath2(options.scopePath);
  if (!(await lstat2(scopePath)).isDirectory()) throw new Error(`Base must be a directory: ${options.scopePath}`);
  return createComponentGraphBuilder(await loadTypeScript(scopePath))({ ...options, scopePath });
}

// src/plugins/artifact-generators/react-component-structure/cli/command.ts
var usage = `Usage: react-component-structure --base <directory> [--tsconfig <path>]
  [--exclude-path <glob> ...] [--exclude-component <glob> ...] [--root <glob> ...] <source-path>...`;
function readValue(args, index, option) {
  const value = args.at(index + 1);
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.
${usage}`);
  return value;
}
function parseArguments(args) {
  let scopePath;
  let tsconfigPath;
  const sourcePaths = [];
  const excludeFilePatterns = [];
  const excludeComponentPatterns = [];
  const rootPatterns = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--base") {
      if (scopePath) throw new Error(`--base may be provided only once.
${usage}`);
      scopePath = readValue(args, index, option);
      index += 1;
    } else if (option === "--tsconfig") {
      if (tsconfigPath) throw new Error(`--tsconfig may be provided only once.
${usage}`);
      tsconfigPath = readValue(args, index, option);
      index += 1;
    } else if (option === "--exclude-path") {
      excludeFilePatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--exclude-component") {
      excludeComponentPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--root") {
      rootPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option.startsWith("--")) {
      throw new Error(`Unknown argument: ${option}
${usage}`);
    } else {
      sourcePaths.push(option);
    }
  }
  if (!scopePath || sourcePaths.length === 0) throw new Error(usage);
  return {
    scopePath,
    sourcePaths,
    ...tsconfigPath ? { tsconfigPath } : {},
    ...excludeFilePatterns.length > 0 ? { excludeFilePatterns } : {},
    ...excludeComponentPatterns.length > 0 ? { excludeComponentPatterns } : {},
    ...rootPatterns.length > 0 ? { rootPatterns } : {}
  };
}
async function executeReactComponentStructureCommand(args, environment) {
  const options = parseArguments(args);
  const graph = await buildComponentGraph(options);
  const resolvedOutputPath = join3(
    await mkdtemp2(join3(tmpdir2(), "architecture-companion-react-components-")),
    "graph.json"
  );
  await mkdir2(dirname2(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(graph, void 0, 2)}
`);
  environment.writeStdout(`${JSON.stringify({ graphPath: resolvedOutputPath })}
`);
  return resolvedOutputPath;
}

// src/plugins/artifact-generators/react-component-structure/run.ts
async function main() {
  try {
    await executeReactComponentStructureCommand(process.argv.slice(2), {
      writeStdout: (output) => process.stdout.write(output)
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
}
void main();
/*! Bundled license information:

is-number/index.js:
  (*!
   * is-number <https://github.com/jonschlinkert/is-number>
   *
   * Copyright (c) 2014-present, Jon Schlinkert.
   * Released under the MIT License.
   *)

to-regex-range/index.js:
  (*!
   * to-regex-range <https://github.com/micromatch/to-regex-range>
   *
   * Copyright (c) 2015-present, Jon Schlinkert.
   * Released under the MIT License.
   *)

fill-range/index.js:
  (*!
   * fill-range <https://github.com/jonschlinkert/fill-range>
   *
   * Copyright (c) 2014-present, Jon Schlinkert.
   * Licensed under the MIT License.
   *)
*/
