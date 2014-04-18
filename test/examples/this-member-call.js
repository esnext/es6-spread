/* jshint esnext:true */

assertSourceEquivalent(
  // We don't need a temporary variable for `this`.
  function() {
    this.foo(...bar);
  },
  function() {
    this.foo.apply(this, Array.prototype.slice.call(bar));
  }
);
