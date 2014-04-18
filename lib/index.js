/* jshint node:true, undef:true, unused:true */

var assert = require('assert');
var through = require('through');
var esprima = require('esprima');
var recast = require('recast');
var types = recast.types;
var n = types.namedTypes;
var b = types.builders;
var NodePath = types.NodePath;

assert.ok(
  /harmony/.test(esprima.version),
  'looking for esprima harmony but found: ' + esprima.version
);

var ExpressionWithoutSideEffects = types.Type.or(n.Identifier, n.ThisExpression);

/**
 * Visits a node of an AST looking for spread elements in arguments. This is
 * intended to be used with the ast-types `traverse()` function.
 *
 * @private
 * @param {Object} node
 * @this {ast-types.Path}
 */
function visitNode(node) {
  if (n.CallExpression.check(node)) {
    if (node.arguments.some(n.SpreadElement.check)) {
      var context;
      var callee = node.callee;

      if (n.MemberExpression.check(callee)) {
        if (ExpressionWithoutSideEffects.check(callee.object)) {
          // foo.bar(...a), safe to use `foo` as context
          context = callee.object;
        } else {
          // foo().bar(...a), not safe to use `foo()` as context
          var scopeBody = this.scope.node.body;

          if (n.BlockStatement.check(scopeBody)) {
            scopeBody = scopeBody.body;
          }

          // var $__0;
          context = uniqueIdentifierForScope(this.scope);
          scopeBody.unshift(
            b.variableDeclaration(
              'var', [b.variableDeclarator(context, null)]
            )
          );

          // ($__0 = foo()).bar(...a)
          callee = b.memberExpression(
            b.assignmentExpression(
              '=',
              context,
              callee.object
            ),
            callee.property,
            callee.computed
          );
        }
      } else {
        context = b.literal(null);
      }

      // foo(1, ...a) -> foo.apply(null, [1].concat(a))
      this.replace(b.callExpression(
        b.memberExpression(
          callee,
          b.identifier('apply'),
          false
        ),
        [context, buildConcatExpression(node.arguments)]
      ));
    }
  } else if (n.ArrayExpression.check(node)) {
    if (node.elements.some(n.SpreadElement.check)) {
      // [1, ...a] -> [1].concat(a)
      this.replace(buildConcatExpression(node.elements));
    }
  } else if (n.NewExpression.check(node)) {
    if (node.arguments.some(n.SpreadElement.check)) {
      // new Foo(...a) -> new (Function.prototype.bind.apply(Foo, [null].concat(a))()
      this.replace(
        b.newExpression(
          b.callExpression(
            b.memberExpression(
              b.memberExpression(
                b.memberExpression(
                  b.identifier('Function'),
                  b.identifier('prototype'),
                  false
                ),
                b.identifier('bind'),
                false
              ),
              b.identifier('apply'),
              false
            ),
            [node.callee, buildConcatExpression([b.literal(null)].concat(node.arguments))]
          ),
          []
        )
      );
    }
  }
}

/**
 * Builds an expression of arrays concatenated together by grouping segments
 * around `SpreadElement`s and treating `SpreadElement`s as arrays.
 *
 * @private
 * @param {Array.<ast-types.Expression>} elements
 * @return {ast-types.Expression}
 */
function buildConcatExpression(elements) {
  // 1, 2, ...a, 3 -> [1, 2], a, [3]
  var arrays = [];
  var remainder;

  elements.forEach(function(element) {
    if (n.SpreadElement.check(element)) {
      if (remainder) {
        arrays.push(b.arrayExpression(remainder));
        remainder = null;
      }
      arrays.push(
        b.callExpression(
          b.memberExpression(
            b.memberExpression(
              b.memberExpression(
                b.identifier('Array'),
                b.identifier('prototype'),
                false
              ),
              b.identifier('slice'),
              false
            ),
            b.identifier('call'),
            false
          ),
          [element.argument]
        )
      );
    } else {
      if (!remainder) { remainder = []; }
      remainder.push(element);
    }
  });

  if (remainder) {
    arrays.push(b.arrayExpression(remainder));
    remainder = null;
  }

  // [1, 2], a, [3] -> [1, 2].concat(a).concat([3])
  var result = arrays[0];
  for (var i = 1; i < arrays.length; i++) {
    result = b.callExpression(
      b.memberExpression(
        result,
        b.identifier('concat'),
        false
      ),
      [arrays[i]]
    );
  }

  return result;
}

var nextId = 0;

/**
 * Generates a unique identifier for use as a variable.
 *
 * @private
 */
function uniqueIdentifierForScope(scope) {
  var result;

  while (scope.declares(result = '$__' + nextId)) {
    nextId++;
  }

  var identifier = b.identifier(result);

  // Ensure this identifier counts as used in this scope.
  var bindings = scope.getBindings();
  if (!Object.prototype.hasOwnProperty(bindings, result)) {
    bindings[result] = [];
  }
  bindings[result].push(new NodePath(identifier));

  return identifier;
}

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
  return types.traverse(ast, visitNode);
}

/**
 * Transform JavaScript written using ES6 by replacing all spread elements with
 * the equivalent ES5.
 *
 *   compile('a(b, ...c, d)'); // 'a.apply(null, [b].concat(c).concat([d]))'
 *
 * @param {string} source
 * @return {string}
 */
function compile(source, mapOptions) {
  mapOptions = mapOptions || {};

  var recastOptions = {
    // Use the harmony branch of Esprima that installs with es6-spread
    // instead of the master branch that recast provides.
    esprima: esprima,

    sourceFileName: mapOptions.sourceFileName,
    sourceMapName: mapOptions.sourceMapName
  };

  var ast = recast.parse(source, recastOptions);
  return recast.print(transform(ast), recastOptions);
}

module.exports = function () {
  var data = '';
  return through(write, end);

  function write (buf) { data += buf; }
  function end () {
      this.queue(module.exports.compile(data).code);
      this.queue(null);
  }
};

module.exports.compile = compile;
module.exports.transform = transform;
