/* jshint node:true, undef:true, unused:true */

var through = require('through');

var recast = require('recast');
var Visitor = require('./visitor');

/**
 * Transform an Esprima AST generated from ES6 by replacing all spread elements
 * with an equivalent approach in ES5.
 *
 * NOTE: The argument may be modified by this function. To prevent modification
 * of your AST, pass a copy instead of a direct reference:
 *
 *   // instead of transform(ast), pass a copy
 *   transform(JSON.parse(JSON.stringify(ast));
 *
 * @param {Object} ast
 * @return {Object}
 */
function transform(ast) {
  return recast.visit(ast, Visitor.visitor);
}

/**
 * Transform JavaScript written using ES6 by replacing all spread elements with
 * the equivalent ES5.
 *
 *   compile('a(b, ...c, d)'); // 'a.apply(null, [b].concat(c).concat([d]))'
 *
 * @param {string} source
 * @param {Object} mapOptions
 * @return {string}
 */
function compile(source, mapOptions) {
  mapOptions = mapOptions || {};

  var recastOptions = {
    sourceFileName: mapOptions.sourceFileName,
    sourceMapName: mapOptions.sourceMapName
  };

  var ast = recast.parse(source, recastOptions);
  return recast.print(transform(ast), recastOptions);
}

module.exports = function() {
  var data = '';
  return through(write, end);

  function write(buf) { data += buf; }
  function end() {
      this.queue(module.exports.compile(data).code);
      this.queue(null);
  }
};

module.exports.compile = compile;
module.exports.transform = transform;
