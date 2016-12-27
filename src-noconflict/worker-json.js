"no use strict";
;(function(window) {
if (typeof window.window != "undefined" && window.document)
    return;
if (window.require && window.define)
    return;

if (!window.console) {
    window.console = function() {
        var msgs = Array.prototype.slice.call(arguments, 0);
        postMessage({type: "log", data: msgs});
    };
    window.console.error =
    window.console.warn = 
    window.console.log =
    window.console.trace = window.console;
}
window.window = window;
window.ace = window;

window.onerror = function(message, file, line, col, err) {
    postMessage({type: "error", data: {
        message: message,
        data: err.data,
        file: file,
        line: line, 
        col: col,
        stack: err.stack
    }});
};

window.normalizeModule = function(parentId, moduleName) {
    // normalize plugin requires
    if (moduleName.indexOf("!") !== -1) {
        var chunks = moduleName.split("!");
        return window.normalizeModule(parentId, chunks[0]) + "!" + window.normalizeModule(parentId, chunks[1]);
    }
    // normalize relative requires
    if (moduleName.charAt(0) == ".") {
        var base = parentId.split("/").slice(0, -1).join("/");
        moduleName = (base ? base + "/" : "") + moduleName;
        
        while (moduleName.indexOf(".") !== -1 && previous != moduleName) {
            var previous = moduleName;
            moduleName = moduleName.replace(/^\.\//, "").replace(/\/\.\//, "/").replace(/[^\/]+\/\.\.\//, "");
        }
    }
    
    return moduleName;
};

window.require = function require(parentId, id) {
    if (!id) {
        id = parentId;
        parentId = null;
    }
    if (!id.charAt)
        throw new Error("worker.js require() accepts only (parentId, id) as arguments");

    id = window.normalizeModule(parentId, id);

    var module = window.require.modules[id];
    if (module) {
        if (!module.initialized) {
            module.initialized = true;
            module.exports = module.factory().exports;
        }
        return module.exports;
    }
   
    if (!window.require.tlns)
        return console.log("unable to load " + id);
    
    var path = resolveModuleId(id, window.require.tlns);
    if (path.slice(-3) != ".js") path += ".js";
    
    window.require.id = id;
    window.require.modules[id] = {}; // prevent infinite loop on broken modules
    importScripts(path);
    return window.require(parentId, id);
};
function resolveModuleId(id, paths) {
    var testPath = id, tail = "";
    while (testPath) {
        var alias = paths[testPath];
        if (typeof alias == "string") {
            return alias + tail;
        } else if (alias) {
            return  alias.location.replace(/\/*$/, "/") + (tail || alias.main || alias.name);
        } else if (alias === false) {
            return "";
        }
        var i = testPath.lastIndexOf("/");
        if (i === -1) break;
        tail = testPath.substr(i) + tail;
        testPath = testPath.slice(0, i);
    }
    return id;
}
window.require.modules = {};
window.require.tlns = {};

window.define = function(id, deps, factory) {
    if (arguments.length == 2) {
        factory = deps;
        if (typeof id != "string") {
            deps = id;
            id = window.require.id;
        }
    } else if (arguments.length == 1) {
        factory = id;
        deps = [];
        id = window.require.id;
    }
    
    if (typeof factory != "function") {
        window.require.modules[id] = {
            exports: factory,
            initialized: true
        };
        return;
    }

    if (!deps.length)
        // If there is no dependencies, we inject "require", "exports" and
        // "module" as dependencies, to provide CommonJS compatibility.
        deps = ["require", "exports", "module"];

    var req = function(childId) {
        return window.require(id, childId);
    };

    window.require.modules[id] = {
        exports: {},
        factory: function() {
            var module = this;
            var returnExports = factory.apply(this, deps.map(function(dep) {
                switch (dep) {
                    // Because "require", "exports" and "module" aren't actual
                    // dependencies, we must handle them seperately.
                    case "require": return req;
                    case "exports": return module.exports;
                    case "module":  return module;
                    // But for all other dependencies, we can just go ahead and
                    // require them.
                    default:        return req(dep);
                }
            }));
            if (returnExports)
                module.exports = returnExports;
            return module;
        }
    };
};
window.define.amd = {};
require.tlns = {};
window.initBaseUrls  = function initBaseUrls(topLevelNamespaces) {
    for (var i in topLevelNamespaces)
        require.tlns[i] = topLevelNamespaces[i];
};

window.initSender = function initSender() {

    var EventEmitter = window.require("ace/lib/event_emitter").EventEmitter;
    var oop = window.require("ace/lib/oop");
    
    var Sender = function() {};
    
    (function() {
        
        oop.implement(this, EventEmitter);
                
        this.callback = function(data, callbackId) {
            postMessage({
                type: "call",
                id: callbackId,
                data: data
            });
        };
    
        this.emit = function(name, data) {
            postMessage({
                type: "event",
                name: name,
                data: data
            });
        };
        
    }).call(Sender.prototype);
    
    return new Sender();
};

var main = window.main = null;
var sender = window.sender = null;

window.onmessage = function(e) {
    var msg = e.data;
    if (msg.event && sender) {
        sender._signal(msg.event, msg.data);
    }
    else if (msg.command) {
        if (main[msg.command])
            main[msg.command].apply(main, msg.args);
        else if (window[msg.command])
            window[msg.command].apply(window, msg.args);
        else
            throw new Error("Unknown command:" + msg.command);
    }
    else if (msg.init) {
        window.initBaseUrls(msg.tlns);
        require("ace/lib/es5-shim");
        sender = window.sender = window.initSender();
        var clazz = require(msg.module)[msg.classname];
        main = window.main = new clazz(sender);
    }
};
})(this);

ace.define("ace/lib/oop",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.inherits = function(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });
};

exports.mixin = function(obj, mixin) {
    for (var key in mixin) {
        obj[key] = mixin[key];
    }
    return obj;
};

exports.implement = function(proto, mixin) {
    exports.mixin(proto, mixin);
};

});

ace.define("ace/range",["require","exports","module"], function(require, exports, module) {
"use strict";
var comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};
var Range = function(startRow, startColumn, endRow, endColumn) {
    this.start = {
        row: startRow,
        column: startColumn
    };

    this.end = {
        row: endRow,
        column: endColumn
    };
};

(function() {
    this.isEqual = function(range) {
        return this.start.row === range.start.row &&
            this.end.row === range.end.row &&
            this.start.column === range.start.column &&
            this.end.column === range.end.column;
    };
    this.toString = function() {
        return ("Range: [" + this.start.row + "/" + this.start.column +
            "] -> [" + this.end.row + "/" + this.end.column + "]");
    };

    this.contains = function(row, column) {
        return this.compare(row, column) == 0;
    };
    this.compareRange = function(range) {
        var cmp,
            end = range.end,
            start = range.start;

        cmp = this.compare(end.row, end.column);
        if (cmp == 1) {
            cmp = this.compare(start.row, start.column);
            if (cmp == 1) {
                return 2;
            } else if (cmp == 0) {
                return 1;
            } else {
                return 0;
            }
        } else if (cmp == -1) {
            return -2;
        } else {
            cmp = this.compare(start.row, start.column);
            if (cmp == -1) {
                return -1;
            } else if (cmp == 1) {
                return 42;
            } else {
                return 0;
            }
        }
    };
    this.comparePoint = function(p) {
        return this.compare(p.row, p.column);
    };
    this.containsRange = function(range) {
        return this.comparePoint(range.start) == 0 && this.comparePoint(range.end) == 0;
    };
    this.intersects = function(range) {
        var cmp = this.compareRange(range);
        return (cmp == -1 || cmp == 0 || cmp == 1);
    };
    this.isEnd = function(row, column) {
        return this.end.row == row && this.end.column == column;
    };
    this.isStart = function(row, column) {
        return this.start.row == row && this.start.column == column;
    };
    this.setStart = function(row, column) {
        if (typeof row == "object") {
            this.start.column = row.column;
            this.start.row = row.row;
        } else {
            this.start.row = row;
            this.start.column = column;
        }
    };
    this.setEnd = function(row, column) {
        if (typeof row == "object") {
            this.end.column = row.column;
            this.end.row = row.row;
        } else {
            this.end.row = row;
            this.end.column = column;
        }
    };
    this.inside = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column) || this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideStart = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideEnd = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.compare = function(row, column) {
        if (!this.isMultiLine()) {
            if (row === this.start.row) {
                return column < this.start.column ? -1 : (column > this.end.column ? 1 : 0);
            }
        }

        if (row < this.start.row)
            return -1;

        if (row > this.end.row)
            return 1;

        if (this.start.row === row)
            return column >= this.start.column ? 0 : -1;

        if (this.end.row === row)
            return column <= this.end.column ? 0 : 1;

        return 0;
    };
    this.compareStart = function(row, column) {
        if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareEnd = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareInside = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.clipRows = function(firstRow, lastRow) {
        if (this.end.row > lastRow)
            var end = {row: lastRow + 1, column: 0};
        else if (this.end.row < firstRow)
            var end = {row: firstRow, column: 0};

        if (this.start.row > lastRow)
            var start = {row: lastRow + 1, column: 0};
        else if (this.start.row < firstRow)
            var start = {row: firstRow, column: 0};

        return Range.fromPoints(start || this.start, end || this.end);
    };
    this.extend = function(row, column) {
        var cmp = this.compare(row, column);

        if (cmp == 0)
            return this;
        else if (cmp == -1)
            var start = {row: row, column: column};
        else
            var end = {row: row, column: column};

        return Range.fromPoints(start || this.start, end || this.end);
    };

    this.isEmpty = function() {
        return (this.start.row === this.end.row && this.start.column === this.end.column);
    };
    this.isMultiLine = function() {
        return (this.start.row !== this.end.row);
    };
    this.clone = function() {
        return Range.fromPoints(this.start, this.end);
    };
    this.collapseRows = function() {
        if (this.end.column == 0)
            return new Range(this.start.row, 0, Math.max(this.start.row, this.end.row-1), 0)
        else
            return new Range(this.start.row, 0, this.end.row, 0)
    };
    this.toScreenRange = function(session) {
        var screenPosStart = session.documentToScreenPosition(this.start);
        var screenPosEnd = session.documentToScreenPosition(this.end);

        return new Range(
            screenPosStart.row, screenPosStart.column,
            screenPosEnd.row, screenPosEnd.column
        );
    };
    this.moveBy = function(row, column) {
        this.start.row += row;
        this.start.column += column;
        this.end.row += row;
        this.end.column += column;
    };

}).call(Range.prototype);
Range.fromPoints = function(start, end) {
    return new Range(start.row, start.column, end.row, end.column);
};
Range.comparePoints = comparePoints;

Range.comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};


exports.Range = Range;
});

ace.define("ace/apply_delta",["require","exports","module"], function(require, exports, module) {
"use strict";

function throwDeltaError(delta, errorText){
    console.log("Invalid Delta:", delta);
    throw "Invalid Delta: " + errorText;
}

function positionInDocument(docLines, position) {
    return position.row    >= 0 && position.row    <  docLines.length &&
           position.column >= 0 && position.column <= docLines[position.row].length;
}

function validateDelta(docLines, delta) {
    if (delta.action != "insert" && delta.action != "remove")
        throwDeltaError(delta, "delta.action must be 'insert' or 'remove'");
    if (!(delta.lines instanceof Array))
        throwDeltaError(delta, "delta.lines must be an Array");
    if (!delta.start || !delta.end)
       throwDeltaError(delta, "delta.start/end must be an present");
    var start = delta.start;
    if (!positionInDocument(docLines, delta.start))
        throwDeltaError(delta, "delta.start must be contained in document");
    var end = delta.end;
    if (delta.action == "remove" && !positionInDocument(docLines, end))
        throwDeltaError(delta, "delta.end must contained in document for 'remove' actions");
    var numRangeRows = end.row - start.row;
    var numRangeLastLineChars = (end.column - (numRangeRows == 0 ? start.column : 0));
    if (numRangeRows != delta.lines.length - 1 || delta.lines[numRangeRows].length != numRangeLastLineChars)
        throwDeltaError(delta, "delta.range must match delta lines");
}

exports.applyDelta = function(docLines, delta, doNotValidate) {
    
    var row = delta.start.row;
    var startColumn = delta.start.column;
    var line = docLines[row] || "";
    switch (delta.action) {
        case "insert":
            var lines = delta.lines;
            if (lines.length === 1) {
                docLines[row] = line.substring(0, startColumn) + delta.lines[0] + line.substring(startColumn);
            } else {
                var args = [row, 1].concat(delta.lines);
                docLines.splice.apply(docLines, args);
                docLines[row] = line.substring(0, startColumn) + docLines[row];
                docLines[row + delta.lines.length - 1] += line.substring(startColumn);
            }
            break;
        case "remove":
            var endColumn = delta.end.column;
            var endRow = delta.end.row;
            if (row === endRow) {
                docLines[row] = line.substring(0, startColumn) + line.substring(endColumn);
            } else {
                docLines.splice(
                    row, endRow - row + 1,
                    line.substring(0, startColumn) + docLines[endRow].substring(endColumn)
                );
            }
            break;
    }
}
});

ace.define("ace/lib/event_emitter",["require","exports","module"], function(require, exports, module) {
"use strict";

var EventEmitter = {};
var stopPropagation = function() { this.propagationStopped = true; };
var preventDefault = function() { this.defaultPrevented = true; };

EventEmitter._emit =
EventEmitter._dispatchEvent = function(eventName, e) {
    this._eventRegistry || (this._eventRegistry = {});
    this._defaultHandlers || (this._defaultHandlers = {});

    var listeners = this._eventRegistry[eventName] || [];
    var defaultHandler = this._defaultHandlers[eventName];
    if (!listeners.length && !defaultHandler)
        return;

    if (typeof e != "object" || !e)
        e = {};

    if (!e.type)
        e.type = eventName;
    if (!e.stopPropagation)
        e.stopPropagation = stopPropagation;
    if (!e.preventDefault)
        e.preventDefault = preventDefault;

    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++) {
        listeners[i](e, this);
        if (e.propagationStopped)
            break;
    }
    
    if (defaultHandler && !e.defaultPrevented)
        return defaultHandler(e, this);
};


EventEmitter._signal = function(eventName, e) {
    var listeners = (this._eventRegistry || {})[eventName];
    if (!listeners)
        return;
    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++)
        listeners[i](e, this);
};

EventEmitter.once = function(eventName, callback) {
    var _self = this;
    callback && this.addEventListener(eventName, function newCallback() {
        _self.removeEventListener(eventName, newCallback);
        callback.apply(null, arguments);
    });
};


EventEmitter.setDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers
    if (!handlers)
        handlers = this._defaultHandlers = {_disabled_: {}};
    
    if (handlers[eventName]) {
        var old = handlers[eventName];
        var disabled = handlers._disabled_[eventName];
        if (!disabled)
            handlers._disabled_[eventName] = disabled = [];
        disabled.push(old);
        var i = disabled.indexOf(callback);
        if (i != -1) 
            disabled.splice(i, 1);
    }
    handlers[eventName] = callback;
};
EventEmitter.removeDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers
    if (!handlers)
        return;
    var disabled = handlers._disabled_[eventName];
    
    if (handlers[eventName] == callback) {
        var old = handlers[eventName];
        if (disabled)
            this.setDefaultHandler(eventName, disabled.pop());
    } else if (disabled) {
        var i = disabled.indexOf(callback);
        if (i != -1)
            disabled.splice(i, 1);
    }
};

EventEmitter.on =
EventEmitter.addEventListener = function(eventName, callback, capturing) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        listeners = this._eventRegistry[eventName] = [];

    if (listeners.indexOf(callback) == -1)
        listeners[capturing ? "unshift" : "push"](callback);
    return callback;
};

EventEmitter.off =
EventEmitter.removeListener =
EventEmitter.removeEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        return;

    var index = listeners.indexOf(callback);
    if (index !== -1)
        listeners.splice(index, 1);
};

EventEmitter.removeAllListeners = function(eventName) {
    if (this._eventRegistry) this._eventRegistry[eventName] = [];
};

exports.EventEmitter = EventEmitter;

});

ace.define("ace/anchor",["require","exports","module","ace/lib/oop","ace/lib/event_emitter"], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var EventEmitter = require("./lib/event_emitter").EventEmitter;

var Anchor = exports.Anchor = function(doc, row, column) {
    this.$onChange = this.onChange.bind(this);
    this.attach(doc);
    
    if (typeof column == "undefined")
        this.setPosition(row.row, row.column);
    else
        this.setPosition(row, column);
};

(function() {

    oop.implement(this, EventEmitter);
    this.getPosition = function() {
        return this.$clipPositionToDocument(this.row, this.column);
    };
    this.getDocument = function() {
        return this.document;
    };
    this.$insertRight = false;
    this.onChange = function(delta) {
        if (delta.start.row == delta.end.row && delta.start.row != this.row)
            return;

        if (delta.start.row > this.row)
            return;
            
        var point = $getTransformedPoint(delta, {row: this.row, column: this.column}, this.$insertRight);
        this.setPosition(point.row, point.column, true);
    };
    
    function $pointsInOrder(point1, point2, equalPointsInOrder) {
        var bColIsAfter = equalPointsInOrder ? point1.column <= point2.column : point1.column < point2.column;
        return (point1.row < point2.row) || (point1.row == point2.row && bColIsAfter);
    }
            
    function $getTransformedPoint(delta, point, moveIfEqual) {
        var deltaIsInsert = delta.action == "insert";
        var deltaRowShift = (deltaIsInsert ? 1 : -1) * (delta.end.row    - delta.start.row);
        var deltaColShift = (deltaIsInsert ? 1 : -1) * (delta.end.column - delta.start.column);
        var deltaStart = delta.start;
        var deltaEnd = deltaIsInsert ? deltaStart : delta.end; // Collapse insert range.
        if ($pointsInOrder(point, deltaStart, moveIfEqual)) {
            return {
                row: point.row,
                column: point.column
            };
        }
        if ($pointsInOrder(deltaEnd, point, !moveIfEqual)) {
            return {
                row: point.row + deltaRowShift,
                column: point.column + (point.row == deltaEnd.row ? deltaColShift : 0)
            };
        }
        
        return {
            row: deltaStart.row,
            column: deltaStart.column
        };
    }
    this.setPosition = function(row, column, noClip) {
        var pos;
        if (noClip) {
            pos = {
                row: row,
                column: column
            };
        } else {
            pos = this.$clipPositionToDocument(row, column);
        }

        if (this.row == pos.row && this.column == pos.column)
            return;

        var old = {
            row: this.row,
            column: this.column
        };

        this.row = pos.row;
        this.column = pos.column;
        this._signal("change", {
            old: old,
            value: pos
        });
    };
    this.detach = function() {
        this.document.removeEventListener("change", this.$onChange);
    };
    this.attach = function(doc) {
        this.document = doc || this.document;
        this.document.on("change", this.$onChange);
    };
    this.$clipPositionToDocument = function(row, column) {
        var pos = {};

        if (row >= this.document.getLength()) {
            pos.row = Math.max(0, this.document.getLength() - 1);
            pos.column = this.document.getLine(pos.row).length;
        }
        else if (row < 0) {
            pos.row = 0;
            pos.column = 0;
        }
        else {
            pos.row = row;
            pos.column = Math.min(this.document.getLine(pos.row).length, Math.max(0, column));
        }

        if (column < 0)
            pos.column = 0;

        return pos;
    };

}).call(Anchor.prototype);

});

ace.define("ace/document",["require","exports","module","ace/lib/oop","ace/apply_delta","ace/lib/event_emitter","ace/range","ace/anchor"], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var applyDelta = require("./apply_delta").applyDelta;
var EventEmitter = require("./lib/event_emitter").EventEmitter;
var Range = require("./range").Range;
var Anchor = require("./anchor").Anchor;

var Document = function(textOrLines) {
    this.$lines = [""];
    if (textOrLines.length === 0) {
        this.$lines = [""];
    } else if (Array.isArray(textOrLines)) {
        this.insertMergedLines({row: 0, column: 0}, textOrLines);
    } else {
        this.insert({row: 0, column:0}, textOrLines);
    }
};

(function() {

    oop.implement(this, EventEmitter);
    this.setValue = function(text) {
        var len = this.getLength() - 1;
        this.remove(new Range(0, 0, len, this.getLine(len).length));
        this.insert({row: 0, column: 0}, text);
    };
    this.getValue = function() {
        return this.getAllLines().join(this.getNewLineCharacter());
    };
    this.createAnchor = function(row, column) {
        return new Anchor(this, row, column);
    };
    if ("aaa".split(/a/).length === 0) {
        this.$split = function(text) {
            return text.replace(/\r\n|\r/g, "\n").split("\n");
        };
    } else {
        this.$split = function(text) {
            return text.split(/\r\n|\r|\n/);
        };
    }


    this.$detectNewLine = function(text) {
        var match = text.match(/^.*?(\r\n|\r|\n)/m);
        this.$autoNewLine = match ? match[1] : "\n";
        this._signal("changeNewLineMode");
    };
    this.getNewLineCharacter = function() {
        switch (this.$newLineMode) {
          case "windows":
            return "\r\n";
          case "unix":
            return "\n";
          default:
            return this.$autoNewLine || "\n";
        }
    };

    this.$autoNewLine = "";
    this.$newLineMode = "auto";
    this.setNewLineMode = function(newLineMode) {
        if (this.$newLineMode === newLineMode)
            return;

        this.$newLineMode = newLineMode;
        this._signal("changeNewLineMode");
    };
    this.getNewLineMode = function() {
        return this.$newLineMode;
    };
    this.isNewLine = function(text) {
        return (text == "\r\n" || text == "\r" || text == "\n");
    };
    this.getLine = function(row) {
        return this.$lines[row] || "";
    };
    this.getLines = function(firstRow, lastRow) {
        return this.$lines.slice(firstRow, lastRow + 1);
    };
    this.getAllLines = function() {
        return this.getLines(0, this.getLength());
    };
    this.getLength = function() {
        return this.$lines.length;
    };
    this.getTextRange = function(range) {
        return this.getLinesForRange(range).join(this.getNewLineCharacter());
    };
    this.getLinesForRange = function(range) {
        var lines;
        if (range.start.row === range.end.row) {
            lines = [this.getLine(range.start.row).substring(range.start.column, range.end.column)];
        } else {
            lines = this.getLines(range.start.row, range.end.row);
            lines[0] = (lines[0] || "").substring(range.start.column);
            var l = lines.length - 1;
            if (range.end.row - range.start.row == l)
                lines[l] = lines[l].substring(0, range.end.column);
        }
        return lines;
    };
    this.insertLines = function(row, lines) {
        console.warn("Use of document.insertLines is deprecated. Use the insertFullLines method instead.");
        return this.insertFullLines(row, lines);
    };
    this.removeLines = function(firstRow, lastRow) {
        console.warn("Use of document.removeLines is deprecated. Use the removeFullLines method instead.");
        return this.removeFullLines(firstRow, lastRow);
    };
    this.insertNewLine = function(position) {
        console.warn("Use of document.insertNewLine is deprecated. Use insertMergedLines(position, [\'\', \'\']) instead.");
        return this.insertMergedLines(position, ["", ""]);
    };
    this.insert = function(position, text) {
        if (this.getLength() <= 1)
            this.$detectNewLine(text);
        
        return this.insertMergedLines(position, this.$split(text));
    };
    this.insertInLine = function(position, text) {
        var start = this.clippedPos(position.row, position.column);
        var end = this.pos(position.row, position.column + text.length);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: [text]
        }, true);
        
        return this.clonePos(end);
    };
    
    this.clippedPos = function(row, column) {
        var length = this.getLength();
        if (row === undefined) {
            row = length;
        } else if (row < 0) {
            row = 0;
        } else if (row >= length) {
            row = length - 1;
            column = undefined;
        }
        var line = this.getLine(row);
        if (column == undefined)
            column = line.length;
        column = Math.min(Math.max(column, 0), line.length);
        return {row: row, column: column};
    };
    
    this.clonePos = function(pos) {
        return {row: pos.row, column: pos.column};
    };
    
    this.pos = function(row, column) {
        return {row: row, column: column};
    };
    
    this.$clipPosition = function(position) {
        var length = this.getLength();
        if (position.row >= length) {
            position.row = Math.max(0, length - 1);
            position.column = this.getLine(length - 1).length;
        } else {
            position.row = Math.max(0, position.row);
            position.column = Math.min(Math.max(position.column, 0), this.getLine(position.row).length);
        }
        return position;
    };
    this.insertFullLines = function(row, lines) {
        row = Math.min(Math.max(row, 0), this.getLength());
        var column = 0;
        if (row < this.getLength()) {
            lines = lines.concat([""]);
            column = 0;
        } else {
            lines = [""].concat(lines);
            row--;
            column = this.$lines[row].length;
        }
        this.insertMergedLines({row: row, column: column}, lines);
    };    
    this.insertMergedLines = function(position, lines) {
        var start = this.clippedPos(position.row, position.column);
        var end = {
            row: start.row + lines.length - 1,
            column: (lines.length == 1 ? start.column : 0) + lines[lines.length - 1].length
        };
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: lines
        });
        
        return this.clonePos(end);
    };
    this.remove = function(range) {
        var start = this.clippedPos(range.start.row, range.start.column);
        var end = this.clippedPos(range.end.row, range.end.column);
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        });
        return this.clonePos(start);
    };
    this.removeInLine = function(row, startColumn, endColumn) {
        var start = this.clippedPos(row, startColumn);
        var end = this.clippedPos(row, endColumn);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        }, true);
        
        return this.clonePos(start);
    };
    this.removeFullLines = function(firstRow, lastRow) {
        firstRow = Math.min(Math.max(0, firstRow), this.getLength() - 1);
        lastRow  = Math.min(Math.max(0, lastRow ), this.getLength() - 1);
        var deleteFirstNewLine = lastRow == this.getLength() - 1 && firstRow > 0;
        var deleteLastNewLine  = lastRow  < this.getLength() - 1;
        var startRow = ( deleteFirstNewLine ? firstRow - 1                  : firstRow                    );
        var startCol = ( deleteFirstNewLine ? this.getLine(startRow).length : 0                           );
        var endRow   = ( deleteLastNewLine  ? lastRow + 1                   : lastRow                     );
        var endCol   = ( deleteLastNewLine  ? 0                             : this.getLine(endRow).length ); 
        var range = new Range(startRow, startCol, endRow, endCol);
        var deletedLines = this.$lines.slice(firstRow, lastRow + 1);
        
        this.applyDelta({
            start: range.start,
            end: range.end,
            action: "remove",
            lines: this.getLinesForRange(range)
        });
        return deletedLines;
    };
    this.removeNewLine = function(row) {
        if (row < this.getLength() - 1 && row >= 0) {
            this.applyDelta({
                start: this.pos(row, this.getLine(row).length),
                end: this.pos(row + 1, 0),
                action: "remove",
                lines: ["", ""]
            });
        }
    };
    this.replace = function(range, text) {
        if (!(range instanceof Range))
            range = Range.fromPoints(range.start, range.end);
        if (text.length === 0 && range.isEmpty())
            return range.start;
        if (text == this.getTextRange(range))
            return range.end;

        this.remove(range);
        var end;
        if (text) {
            end = this.insert(range.start, text);
        }
        else {
            end = range.start;
        }
        
        return end;
    };
    this.applyDeltas = function(deltas) {
        for (var i=0; i<deltas.length; i++) {
            this.applyDelta(deltas[i]);
        }
    };
    this.revertDeltas = function(deltas) {
        for (var i=deltas.length-1; i>=0; i--) {
            this.revertDelta(deltas[i]);
        }
    };
    this.applyDelta = function(delta, doNotValidate) {
        var isInsert = delta.action == "insert";
        if (isInsert ? delta.lines.length <= 1 && !delta.lines[0]
            : !Range.comparePoints(delta.start, delta.end)) {
            return;
        }
        
        if (isInsert && delta.lines.length > 20000)
            this.$splitAndapplyLargeDelta(delta, 20000);
        applyDelta(this.$lines, delta, doNotValidate);
        this._signal("change", delta);
    };
    
    this.$splitAndapplyLargeDelta = function(delta, MAX) {
        var lines = delta.lines;
        var l = lines.length;
        var row = delta.start.row; 
        var column = delta.start.column;
        var from = 0, to = 0;
        do {
            from = to;
            to += MAX - 1;
            var chunk = lines.slice(from, to);
            if (to > l) {
                delta.lines = chunk;
                delta.start.row = row + from;
                delta.start.column = column;
                break;
            }
            chunk.push("");
            this.applyDelta({
                start: this.pos(row + from, column),
                end: this.pos(row + to, column = 0),
                action: delta.action,
                lines: chunk
            }, true);
        } while(true);
    };
    this.revertDelta = function(delta) {
        this.applyDelta({
            start: this.clonePos(delta.start),
            end: this.clonePos(delta.end),
            action: (delta.action == "insert" ? "remove" : "insert"),
            lines: delta.lines.slice()
        });
    };
    this.indexToPosition = function(index, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        for (var i = startRow || 0, l = lines.length; i < l; i++) {
            index -= lines[i].length + newlineLength;
            if (index < 0)
                return {row: i, column: index + lines[i].length + newlineLength};
        }
        return {row: l-1, column: lines[l-1].length};
    };
    this.positionToIndex = function(pos, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        var index = 0;
        var row = Math.min(pos.row, lines.length);
        for (var i = startRow || 0; i < row; ++i)
            index += lines[i].length + newlineLength;

        return index + pos.column;
    };

}).call(Document.prototype);

exports.Document = Document;
});

ace.define("ace/lib/lang",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.last = function(a) {
    return a[a.length - 1];
};

exports.stringReverse = function(string) {
    return string.split("").reverse().join("");
};

exports.stringRepeat = function (string, count) {
    var result = '';
    while (count > 0) {
        if (count & 1)
            result += string;

        if (count >>= 1)
            string += string;
    }
    return result;
};

var trimBeginRegexp = /^\s\s*/;
var trimEndRegexp = /\s\s*$/;

exports.stringTrimLeft = function (string) {
    return string.replace(trimBeginRegexp, '');
};

exports.stringTrimRight = function (string) {
    return string.replace(trimEndRegexp, '');
};

exports.copyObject = function(obj) {
    var copy = {};
    for (var key in obj) {
        copy[key] = obj[key];
    }
    return copy;
};

exports.copyArray = function(array){
    var copy = [];
    for (var i=0, l=array.length; i<l; i++) {
        if (array[i] && typeof array[i] == "object")
            copy[i] = this.copyObject( array[i] );
        else 
            copy[i] = array[i];
    }
    return copy;
};

exports.deepCopy = function deepCopy(obj) {
    if (typeof obj !== "object" || !obj)
        return obj;
    var copy;
    if (Array.isArray(obj)) {
        copy = [];
        for (var key = 0; key < obj.length; key++) {
            copy[key] = deepCopy(obj[key]);
        }
        return copy;
    }
    var cons = obj.constructor;
    if (cons === RegExp)
        return obj;
    
    copy = cons();
    for (var key in obj) {
        copy[key] = deepCopy(obj[key]);
    }
    return copy;
};

exports.arrayToMap = function(arr) {
    var map = {};
    for (var i=0; i<arr.length; i++) {
        map[arr[i]] = 1;
    }
    return map;

};

exports.createMap = function(props) {
    var map = Object.create(null);
    for (var i in props) {
        map[i] = props[i];
    }
    return map;
};
exports.arrayRemove = function(array, value) {
  for (var i = 0; i <= array.length; i++) {
    if (value === array[i]) {
      array.splice(i, 1);
    }
  }
};

exports.escapeRegExp = function(str) {
    return str.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1');
};

exports.escapeHTML = function(str) {
    return str.replace(/&/g, "&#38;").replace(/"/g, "&#34;").replace(/'/g, "&#39;").replace(/</g, "&#60;");
};

exports.getMatchOffsets = function(string, regExp) {
    var matches = [];

    string.replace(regExp, function(str) {
        matches.push({
            offset: arguments[arguments.length-2],
            length: str.length
        });
    });

    return matches;
};
exports.deferredCall = function(fcn) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var deferred = function(timeout) {
        deferred.cancel();
        timer = setTimeout(callback, timeout || 0);
        return deferred;
    };

    deferred.schedule = deferred;

    deferred.call = function() {
        this.cancel();
        fcn();
        return deferred;
    };

    deferred.cancel = function() {
        clearTimeout(timer);
        timer = null;
        return deferred;
    };
    
    deferred.isPending = function() {
        return timer;
    };

    return deferred;
};


exports.delayedCall = function(fcn, defaultTimeout) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var _self = function(timeout) {
        if (timer == null)
            timer = setTimeout(callback, timeout || defaultTimeout);
    };

    _self.delay = function(timeout) {
        timer && clearTimeout(timer);
        timer = setTimeout(callback, timeout || defaultTimeout);
    };
    _self.schedule = _self;

    _self.call = function() {
        this.cancel();
        fcn();
    };

    _self.cancel = function() {
        timer && clearTimeout(timer);
        timer = null;
    };

    _self.isPending = function() {
        return timer;
    };

    return _self;
};
});

ace.define("ace/worker/mirror",["require","exports","module","ace/range","ace/document","ace/lib/lang"], function(require, exports, module) {
"use strict";

var Range = require("../range").Range;
var Document = require("../document").Document;
var lang = require("../lib/lang");
    
var Mirror = exports.Mirror = function(sender) {
    this.sender = sender;
    var doc = this.doc = new Document("");
    
    var deferredUpdate = this.deferredUpdate = lang.delayedCall(this.onUpdate.bind(this));
    
    var _self = this;
    sender.on("change", function(e) {
        var data = e.data;
        if (data[0].start) {
            doc.applyDeltas(data);
        } else {
            for (var i = 0; i < data.length; i += 2) {
                if (Array.isArray(data[i+1])) {
                    var d = {action: "insert", start: data[i], lines: data[i+1]};
                } else {
                    var d = {action: "remove", start: data[i], end: data[i+1]};
                }
                doc.applyDelta(d, true);
            }
        }
        if (_self.$timeout)
            return deferredUpdate.schedule(_self.$timeout);
        _self.onUpdate();
    });
};

(function() {
    
    this.$timeout = 500;
    
    this.setTimeout = function(timeout) {
        this.$timeout = timeout;
    };
    
    this.setValue = function(value) {
        this.doc.setValue(value);
        this.deferredUpdate.schedule(this.$timeout);
    };
    
    this.getValue = function(callbackId) {
        this.sender.callback(this.doc.getValue(), callbackId);
    };
    
    this.onUpdate = function() {
    };
    
    this.isPending = function() {
        return this.deferredUpdate.isPending();
    };
    
}).call(Mirror.prototype);

});

ace.define("ace/mode/json/json",["require","exports","module"], function (require, exports) {
'use strict';
function localize(info, message) {
    var args = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        args[_i - 2] = arguments[_i];
    }
    return message.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] !== 'undefined' ? args[number] : match; });
}   

(function (ScanError) {
    ScanError[ScanError["None"] = 0] = "None";
    ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
    ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
    ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
    ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
    ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
})(exports.ScanError || (exports.ScanError = {}));
var ScanError = exports.ScanError;
(function (SyntaxKind) {
    SyntaxKind[SyntaxKind["Unknown"] = 0] = "Unknown";
    SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
    SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
    SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
    SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
    SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
    SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
    SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
    SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
    SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
    SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
    SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
    SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
    SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
    SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
    SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
    SyntaxKind[SyntaxKind["EOF"] = 16] = "EOF";
})(exports.SyntaxKind || (exports.SyntaxKind = {}));
var SyntaxKind = exports.SyntaxKind;
function createScanner(text, ignoreTrivia) {
    if (ignoreTrivia === void 0) { ignoreTrivia = false; }
    var pos = 0, len = text.length, value = '', tokenOffset = 0, token = SyntaxKind.Unknown, scanError = ScanError.None;
    function scanHexDigits(count, exact) {
        var digits = 0;
        var value = 0;
        while (digits < count || !exact) {
            var ch = text.charCodeAt(pos);
            if (ch >= CharacterCodes._0 && ch <= CharacterCodes._9) {
                value = value * 16 + ch - CharacterCodes._0;
            }
            else if (ch >= CharacterCodes.A && ch <= CharacterCodes.F) {
                value = value * 16 + ch - CharacterCodes.A + 10;
            }
            else if (ch >= CharacterCodes.a && ch <= CharacterCodes.f) {
                value = value * 16 + ch - CharacterCodes.a + 10;
            }
            else {
                break;
            }
            pos++;
            digits++;
        }
        if (digits < count) {
            value = -1;
        }
        return value;
    }
    function scanNumber() {
        var start = pos;
        if (text.charCodeAt(pos) === CharacterCodes._0) {
            pos++;
        }
        else {
            pos++;
            while (pos < text.length && isDigit(text.charCodeAt(pos))) {
                pos++;
            }
        }
        if (pos < text.length && text.charCodeAt(pos) === CharacterCodes.dot) {
            pos++;
            if (pos < text.length && isDigit(text.charCodeAt(pos))) {
                pos++;
                while (pos < text.length && isDigit(text.charCodeAt(pos))) {
                    pos++;
                }
            }
            else {
                scanError = ScanError.UnexpectedEndOfNumber;
                return text.substring(start, end);
            }
        }
        var end = pos;
        if (pos < text.length && (text.charCodeAt(pos) === CharacterCodes.E || text.charCodeAt(pos) === CharacterCodes.e)) {
            pos++;
            if (pos < text.length && text.charCodeAt(pos) === CharacterCodes.plus || text.charCodeAt(pos) === CharacterCodes.minus) {
                pos++;
            }
            if (pos < text.length && isDigit(text.charCodeAt(pos))) {
                pos++;
                while (pos < text.length && isDigit(text.charCodeAt(pos))) {
                    pos++;
                }
                end = pos;
            }
            else {
                scanError = ScanError.UnexpectedEndOfNumber;
            }
        }
        return text.substring(start, end);
    }
    function scanString() {
        var result = '', start = pos;
        while (true) {
            if (pos >= len) {
                result += text.substring(start, pos);
                scanError = ScanError.UnexpectedEndOfString;
                break;
            }
            var ch = text.charCodeAt(pos);
            if (ch === CharacterCodes.doubleQuote) {
                result += text.substring(start, pos);
                pos++;
                break;
            }
            if (ch === CharacterCodes.backslash) {
                result += text.substring(start, pos);
                pos++;
                if (pos >= len) {
                    scanError = ScanError.UnexpectedEndOfString;
                    break;
                }
                ch = text.charCodeAt(pos++);
                switch (ch) {
                    case CharacterCodes.doubleQuote:
                        result += '\"';
                        break;
                    case CharacterCodes.backslash:
                        result += '\\';
                        break;
                    case CharacterCodes.slash:
                        result += '/';
                        break;
                    case CharacterCodes.b:
                        result += '\b';
                        break;
                    case CharacterCodes.f:
                        result += '\f';
                        break;
                    case CharacterCodes.n:
                        result += '\n';
                        break;
                    case CharacterCodes.r:
                        result += '\r';
                        break;
                    case CharacterCodes.t:
                        result += '\t';
                        break;
                    case CharacterCodes.u:
                        var ch = scanHexDigits(4, true);
                        if (ch >= 0) {
                            result += String.fromCharCode(ch);
                        }
                        else {
                            scanError = ScanError.InvalidUnicode;
                        }
                        break;
                    default:
                        scanError = ScanError.InvalidEscapeCharacter;
                }
                start = pos;
                continue;
            }
            if (isLineBreak(ch)) {
                result += text.substring(start, pos);
                scanError = ScanError.UnexpectedEndOfString;
                break;
            }
            pos++;
        }
        return result;
    }
    function scanNext() {
        value = '';
        scanError = ScanError.None;
        tokenOffset = pos;
        if (pos >= len) {
            tokenOffset = len;
            return token = SyntaxKind.EOF;
        }
        var code = text.charCodeAt(pos);
        if (isWhiteSpace(code)) {
            do {
                pos++;
                value += String.fromCharCode(code);
                code = text.charCodeAt(pos);
            } while (isWhiteSpace(code));
            return token = SyntaxKind.Trivia;
        }
        if (isLineBreak(code)) {
            pos++;
            value += String.fromCharCode(code);
            if (code === CharacterCodes.carriageReturn && text.charCodeAt(pos) === CharacterCodes.lineFeed) {
                pos++;
                value += '\n';
            }
            return token = SyntaxKind.LineBreakTrivia;
        }
        switch (code) {
            case CharacterCodes.openBrace:
                pos++;
                return token = SyntaxKind.OpenBraceToken;
            case CharacterCodes.closeBrace:
                pos++;
                return token = SyntaxKind.CloseBraceToken;
            case CharacterCodes.openBracket:
                pos++;
                return token = SyntaxKind.OpenBracketToken;
            case CharacterCodes.closeBracket:
                pos++;
                return token = SyntaxKind.CloseBracketToken;
            case CharacterCodes.colon:
                pos++;
                return token = SyntaxKind.ColonToken;
            case CharacterCodes.comma:
                pos++;
                return token = SyntaxKind.CommaToken;
            case CharacterCodes.doubleQuote:
                pos++;
                value = scanString();
                return token = SyntaxKind.StringLiteral;
            case CharacterCodes.slash:
                var start = pos - 1;
                if (text.charCodeAt(pos + 1) === CharacterCodes.slash) {
                    pos += 2;
                    while (pos < len) {
                        if (isLineBreak(text.charCodeAt(pos))) {
                            break;
                        }
                        pos++;
                    }
                    value = text.substring(start, pos);
                    return token = SyntaxKind.LineCommentTrivia;
                }
                if (text.charCodeAt(pos + 1) === CharacterCodes.asterisk) {
                    pos += 2;
                    var safeLength = len - 1; // For lookahead.
                    var commentClosed = false;
                    while (pos < safeLength) {
                        var ch = text.charCodeAt(pos);
                        if (ch === CharacterCodes.asterisk && text.charCodeAt(pos + 1) === CharacterCodes.slash) {
                            pos += 2;
                            commentClosed = true;
                            break;
                        }
                        pos++;
                    }
                    if (!commentClosed) {
                        pos++;
                        scanError = ScanError.UnexpectedEndOfComment;
                    }
                    value = text.substring(start, pos);
                    return token = SyntaxKind.BlockCommentTrivia;
                }
                value += String.fromCharCode(code);
                pos++;
                return token = SyntaxKind.Unknown;
            case CharacterCodes.minus:
                value += String.fromCharCode(code);
                pos++;
                if (pos === len || !isDigit(text.charCodeAt(pos))) {
                    return token = SyntaxKind.Unknown;
                }
            case CharacterCodes._0:
            case CharacterCodes._1:
            case CharacterCodes._2:
            case CharacterCodes._3:
            case CharacterCodes._4:
            case CharacterCodes._5:
            case CharacterCodes._6:
            case CharacterCodes._7:
            case CharacterCodes._8:
            case CharacterCodes._9:
                value += scanNumber();
                return token = SyntaxKind.NumericLiteral;
            default:
                while (pos < len && isUnknownContentCharacter(code)) {
                    pos++;
                    code = text.charCodeAt(pos);
                }
                if (tokenOffset !== pos) {
                    value = text.substring(tokenOffset, pos);
                    switch (value) {
                        case 'true': return token = SyntaxKind.TrueKeyword;
                        case 'false': return token = SyntaxKind.FalseKeyword;
                        case 'null': return token = SyntaxKind.NullKeyword;
                    }
                    return token = SyntaxKind.Unknown;
                }
                value += String.fromCharCode(code);
                pos++;
                return token = SyntaxKind.Unknown;
        }
    }
    function isUnknownContentCharacter(code) {
        if (isWhiteSpace(code) || isLineBreak(code)) {
            return false;
        }
        switch (code) {
            case CharacterCodes.closeBrace:
            case CharacterCodes.closeBracket:
            case CharacterCodes.openBrace:
            case CharacterCodes.openBracket:
            case CharacterCodes.doubleQuote:
            case CharacterCodes.colon:
            case CharacterCodes.comma:
                return false;
        }
        return true;
    }
    function scanNextNonTrivia() {
        var result;
        do {
            result = scanNext();
        } while (result >= SyntaxKind.LineCommentTrivia && result <= SyntaxKind.Trivia);
        return result;
    }
    return {
        getPosition: function () { return pos; },
        scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
        getToken: function () { return token; },
        getTokenValue: function () { return value; },
        getTokenOffset: function () { return tokenOffset; },
        getTokenLength: function () { return pos - tokenOffset; },
        getTokenError: function () { return scanError; }
    };
}
exports.createScanner = createScanner;
function isWhiteSpace(ch) {
    return ch === CharacterCodes.space || ch === CharacterCodes.tab || ch === CharacterCodes.verticalTab || ch === CharacterCodes.formFeed ||
        ch === CharacterCodes.nonBreakingSpace || ch === CharacterCodes.ogham || ch >= CharacterCodes.enQuad && ch <= CharacterCodes.zeroWidthSpace ||
        ch === CharacterCodes.narrowNoBreakSpace || ch === CharacterCodes.mathematicalSpace || ch === CharacterCodes.ideographicSpace || ch === CharacterCodes.byteOrderMark;
}
function isLineBreak(ch) {
    return ch === CharacterCodes.lineFeed || ch === CharacterCodes.carriageReturn || ch === CharacterCodes.lineSeparator || ch === CharacterCodes.paragraphSeparator;
}
function isDigit(ch) {
    return ch >= CharacterCodes._0 && ch <= CharacterCodes._9;
}
function isLetter(ch) {
    return ch >= CharacterCodes.a && ch <= CharacterCodes.z || ch >= CharacterCodes.A && ch <= CharacterCodes.Z;
}
exports.isLetter = isLetter;
var CharacterCodes;
(function (CharacterCodes) {
    CharacterCodes[CharacterCodes["nullCharacter"] = 0] = "nullCharacter";
    CharacterCodes[CharacterCodes["maxAsciiCharacter"] = 127] = "maxAsciiCharacter";
    CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
    CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
    CharacterCodes[CharacterCodes["lineSeparator"] = 8232] = "lineSeparator";
    CharacterCodes[CharacterCodes["paragraphSeparator"] = 8233] = "paragraphSeparator";
    CharacterCodes[CharacterCodes["nextLine"] = 133] = "nextLine";
    CharacterCodes[CharacterCodes["space"] = 32] = "space";
    CharacterCodes[CharacterCodes["nonBreakingSpace"] = 160] = "nonBreakingSpace";
    CharacterCodes[CharacterCodes["enQuad"] = 8192] = "enQuad";
    CharacterCodes[CharacterCodes["emQuad"] = 8193] = "emQuad";
    CharacterCodes[CharacterCodes["enSpace"] = 8194] = "enSpace";
    CharacterCodes[CharacterCodes["emSpace"] = 8195] = "emSpace";
    CharacterCodes[CharacterCodes["threePerEmSpace"] = 8196] = "threePerEmSpace";
    CharacterCodes[CharacterCodes["fourPerEmSpace"] = 8197] = "fourPerEmSpace";
    CharacterCodes[CharacterCodes["sixPerEmSpace"] = 8198] = "sixPerEmSpace";
    CharacterCodes[CharacterCodes["figureSpace"] = 8199] = "figureSpace";
    CharacterCodes[CharacterCodes["punctuationSpace"] = 8200] = "punctuationSpace";
    CharacterCodes[CharacterCodes["thinSpace"] = 8201] = "thinSpace";
    CharacterCodes[CharacterCodes["hairSpace"] = 8202] = "hairSpace";
    CharacterCodes[CharacterCodes["zeroWidthSpace"] = 8203] = "zeroWidthSpace";
    CharacterCodes[CharacterCodes["narrowNoBreakSpace"] = 8239] = "narrowNoBreakSpace";
    CharacterCodes[CharacterCodes["ideographicSpace"] = 12288] = "ideographicSpace";
    CharacterCodes[CharacterCodes["mathematicalSpace"] = 8287] = "mathematicalSpace";
    CharacterCodes[CharacterCodes["ogham"] = 5760] = "ogham";
    CharacterCodes[CharacterCodes["_"] = 95] = "_";
    CharacterCodes[CharacterCodes["$"] = 36] = "$";
    CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
    CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
    CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
    CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
    CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
    CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
    CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
    CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
    CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
    CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
    CharacterCodes[CharacterCodes["a"] = 97] = "a";
    CharacterCodes[CharacterCodes["b"] = 98] = "b";
    CharacterCodes[CharacterCodes["c"] = 99] = "c";
    CharacterCodes[CharacterCodes["d"] = 100] = "d";
    CharacterCodes[CharacterCodes["e"] = 101] = "e";
    CharacterCodes[CharacterCodes["f"] = 102] = "f";
    CharacterCodes[CharacterCodes["g"] = 103] = "g";
    CharacterCodes[CharacterCodes["h"] = 104] = "h";
    CharacterCodes[CharacterCodes["i"] = 105] = "i";
    CharacterCodes[CharacterCodes["j"] = 106] = "j";
    CharacterCodes[CharacterCodes["k"] = 107] = "k";
    CharacterCodes[CharacterCodes["l"] = 108] = "l";
    CharacterCodes[CharacterCodes["m"] = 109] = "m";
    CharacterCodes[CharacterCodes["n"] = 110] = "n";
    CharacterCodes[CharacterCodes["o"] = 111] = "o";
    CharacterCodes[CharacterCodes["p"] = 112] = "p";
    CharacterCodes[CharacterCodes["q"] = 113] = "q";
    CharacterCodes[CharacterCodes["r"] = 114] = "r";
    CharacterCodes[CharacterCodes["s"] = 115] = "s";
    CharacterCodes[CharacterCodes["t"] = 116] = "t";
    CharacterCodes[CharacterCodes["u"] = 117] = "u";
    CharacterCodes[CharacterCodes["v"] = 118] = "v";
    CharacterCodes[CharacterCodes["w"] = 119] = "w";
    CharacterCodes[CharacterCodes["x"] = 120] = "x";
    CharacterCodes[CharacterCodes["y"] = 121] = "y";
    CharacterCodes[CharacterCodes["z"] = 122] = "z";
    CharacterCodes[CharacterCodes["A"] = 65] = "A";
    CharacterCodes[CharacterCodes["B"] = 66] = "B";
    CharacterCodes[CharacterCodes["C"] = 67] = "C";
    CharacterCodes[CharacterCodes["D"] = 68] = "D";
    CharacterCodes[CharacterCodes["E"] = 69] = "E";
    CharacterCodes[CharacterCodes["F"] = 70] = "F";
    CharacterCodes[CharacterCodes["G"] = 71] = "G";
    CharacterCodes[CharacterCodes["H"] = 72] = "H";
    CharacterCodes[CharacterCodes["I"] = 73] = "I";
    CharacterCodes[CharacterCodes["J"] = 74] = "J";
    CharacterCodes[CharacterCodes["K"] = 75] = "K";
    CharacterCodes[CharacterCodes["L"] = 76] = "L";
    CharacterCodes[CharacterCodes["M"] = 77] = "M";
    CharacterCodes[CharacterCodes["N"] = 78] = "N";
    CharacterCodes[CharacterCodes["O"] = 79] = "O";
    CharacterCodes[CharacterCodes["P"] = 80] = "P";
    CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
    CharacterCodes[CharacterCodes["R"] = 82] = "R";
    CharacterCodes[CharacterCodes["S"] = 83] = "S";
    CharacterCodes[CharacterCodes["T"] = 84] = "T";
    CharacterCodes[CharacterCodes["U"] = 85] = "U";
    CharacterCodes[CharacterCodes["V"] = 86] = "V";
    CharacterCodes[CharacterCodes["W"] = 87] = "W";
    CharacterCodes[CharacterCodes["X"] = 88] = "X";
    CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
    CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
    CharacterCodes[CharacterCodes["ampersand"] = 38] = "ampersand";
    CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
    CharacterCodes[CharacterCodes["at"] = 64] = "at";
    CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
    CharacterCodes[CharacterCodes["bar"] = 124] = "bar";
    CharacterCodes[CharacterCodes["caret"] = 94] = "caret";
    CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
    CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
    CharacterCodes[CharacterCodes["closeParen"] = 41] = "closeParen";
    CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
    CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
    CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
    CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
    CharacterCodes[CharacterCodes["equals"] = 61] = "equals";
    CharacterCodes[CharacterCodes["exclamation"] = 33] = "exclamation";
    CharacterCodes[CharacterCodes["greaterThan"] = 62] = "greaterThan";
    CharacterCodes[CharacterCodes["lessThan"] = 60] = "lessThan";
    CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
    CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
    CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
    CharacterCodes[CharacterCodes["openParen"] = 40] = "openParen";
    CharacterCodes[CharacterCodes["percent"] = 37] = "percent";
    CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
    CharacterCodes[CharacterCodes["question"] = 63] = "question";
    CharacterCodes[CharacterCodes["semicolon"] = 59] = "semicolon";
    CharacterCodes[CharacterCodes["singleQuote"] = 39] = "singleQuote";
    CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
    CharacterCodes[CharacterCodes["tilde"] = 126] = "tilde";
    CharacterCodes[CharacterCodes["backspace"] = 8] = "backspace";
    CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
    CharacterCodes[CharacterCodes["byteOrderMark"] = 65279] = "byteOrderMark";
    CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
    CharacterCodes[CharacterCodes["verticalTab"] = 11] = "verticalTab";
})(CharacterCodes || (CharacterCodes = {}));
function stripComments(text, replaceCh) {
    var _scanner = createScanner(text), parts = [], kind, offset = 0, pos;
    do {
        pos = _scanner.getPosition();
        kind = _scanner.scan();
        switch (kind) {
            case SyntaxKind.LineCommentTrivia:
            case SyntaxKind.BlockCommentTrivia:
            case SyntaxKind.EOF:
                if (offset !== pos) {
                    parts.push(text.substring(offset, pos));
                }
                if (replaceCh !== void 0) {
                    parts.push(_scanner.getTokenValue().replace(/[^\r\n]/g, replaceCh));
                }
                offset = _scanner.getPosition();
                break;
        }
    } while (kind !== SyntaxKind.EOF);
    return parts.join('');
}
exports.stripComments = stripComments;
function parse(text, errors) {
    if (errors === void 0) { errors = []; }
    var noMatch = Object();
    var _scanner = createScanner(text, true);
    function scanNext() {
        var token = _scanner.scan();
        while (token === SyntaxKind.Unknown) {
            handleError(localize('UnknownSymbol', 'Invalid symbol'));
            token = _scanner.scan();
        }
        return token;
    }
    function handleError(message, skipUntilAfter, skipUntil) {
        if (skipUntilAfter === void 0) { skipUntilAfter = []; }
        if (skipUntil === void 0) { skipUntil = []; }
        errors.push(message);
        if (skipUntilAfter.length + skipUntil.length > 0) {
            var token = _scanner.getToken();
            while (token !== SyntaxKind.EOF) {
                if (skipUntilAfter.indexOf(token) !== -1) {
                    scanNext();
                    break;
                }
                else if (skipUntil.indexOf(token) !== -1) {
                    break;
                }
                token = scanNext();
            }
        }
    }
    function parseString() {
        if (_scanner.getToken() !== SyntaxKind.StringLiteral) {
            return noMatch;
        }
        var value = _scanner.getTokenValue();
        scanNext();
        return value;
    }
    function parseLiteral() {
        var value;
        switch (_scanner.getToken()) {
            case SyntaxKind.NumericLiteral:
                try {
                    value = JSON.parse(_scanner.getTokenValue());
                    if (typeof value !== 'number') {
                        handleError(localize('InvalidNumberFormat', 'Invalid number format'));
                        value = 0;
                    }
                }
                catch (e) {
                    value = 0;
                }
                break;
            case SyntaxKind.NullKeyword:
                value = null;
                break;
            case SyntaxKind.TrueKeyword:
                value = true;
                break;
            case SyntaxKind.FalseKeyword:
                value = false;
                break;
            default:
                return noMatch;
        }
        scanNext();
        return value;
    }
    function parseProperty(result) {
        var key = parseString();
        if (key === noMatch) {
            handleError(localize('PropertyExpected', 'Property name expected'), [], [SyntaxKind.CloseBraceToken, SyntaxKind.CommaToken]);
            return false;
        }
        if (_scanner.getToken() === SyntaxKind.ColonToken) {
            scanNext(); // consume colon
            var value = parseValue();
            if (value !== noMatch) {
                result[key] = value;
            }
            else {
                handleError(localize('ValueExpected', 'Value expected'), [], [SyntaxKind.CloseBraceToken, SyntaxKind.CommaToken]);
            }
        }
        else {
            handleError(localize('ColonExpected', 'Colon expected'), [], [SyntaxKind.CloseBraceToken, SyntaxKind.CommaToken]);
        }
        return true;
    }
    function parseObject() {
        if (_scanner.getToken() !== SyntaxKind.OpenBraceToken) {
            return noMatch;
        }
        var obj = {};
        scanNext(); // consume open brace
        var needsComma = false;
        while (_scanner.getToken() !== SyntaxKind.CloseBraceToken && _scanner.getToken() !== SyntaxKind.EOF) {
            if (_scanner.getToken() === SyntaxKind.CommaToken) {
                if (!needsComma) {
                    handleError(localize('ValeExpected', 'Value expected'), [], []);
                }
                scanNext(); // consume comma
            }
            else if (needsComma) {
                handleError(localize('CommaExpected', 'Comma expected'), [], []);
            }
            var propertyParsed = parseProperty(obj);
            if (!propertyParsed) {
                handleError(localize('ValueExpected', 'Value expected'), [], [SyntaxKind.CloseBraceToken, SyntaxKind.CommaToken]);
            }
            needsComma = true;
        }
        if (_scanner.getToken() !== SyntaxKind.CloseBraceToken) {
            handleError(localize('CloseBraceExpected', 'Closing brace expected'), [SyntaxKind.CloseBraceToken], []);
        }
        else {
            scanNext(); // consume close brace
        }
        return obj;
    }
    function parseArray() {
        if (_scanner.getToken() !== SyntaxKind.OpenBracketToken) {
            return noMatch;
        }
        var arr = [];
        scanNext(); // consume open bracket
        var needsComma = false;
        while (_scanner.getToken() !== SyntaxKind.CloseBracketToken && _scanner.getToken() !== SyntaxKind.EOF) {
            if (_scanner.getToken() === SyntaxKind.CommaToken) {
                if (!needsComma) {
                    handleError(localize('ValueExpected', 'Value expected'), [], []);
                }
                scanNext(); // consume comma
            }
            else if (needsComma) {
                handleError(localize('CommaExpected', 'Comma expected'), [], []);
            }
            var value = parseValue();
            if (value === noMatch) {
                handleError(localize('ValueExpected', 'Value expected'), [], [SyntaxKind.CloseBracketToken, SyntaxKind.CommaToken]);
            }
            else {
                arr.push(value);
            }
            needsComma = true;
        }
        if (_scanner.getToken() !== SyntaxKind.CloseBracketToken) {
            handleError(localize('CloseBracketExpected', 'Closing bracket expected'), [SyntaxKind.CloseBracketToken], []);
        }
        else {
            scanNext(); // consume close bracket
        }
        return arr;
    }
    function parseValue() {
        var result = parseArray();
        if (result !== noMatch) {
            return result;
        }
        result = parseObject();
        if (result !== noMatch) {
            return result;
        }
        result = parseString();
        if (result !== noMatch) {
            return result;
        }
        return parseLiteral();
    }
    scanNext();
    var value = parseValue();
    if (value === noMatch) {
        handleError(localize('ValueExpected', 'Value expected'), [], []);
        return void 0;
    }
    if (_scanner.getToken() !== SyntaxKind.EOF) {
        handleError(localize('EOFExpected', 'End of content expected'), [], []);
    }
    return value;
}
exports.parse = parse;
});

ace.define("ace/mode/json/jsonLocation",["require","exports","module"], function (require, exports) {
'use strict';
var JSONLocation = (function () {
    function JSONLocation(segments) {
        this.segments = segments;
    }
    JSONLocation.prototype.append = function (segment) {
        return new JSONLocation(this.segments.concat(segment));
    };
    JSONLocation.prototype.getSegments = function () {
        return this.segments;
    };
    JSONLocation.prototype.matches = function (segments) {
        var k = 0;
        for (var i = 0; k < segments.length && i < this.segments.length; i++) {
            if (segments[k] === this.segments[i] || segments[k] === '*') {
                k++;
            }
            else if (segments[k] !== '**') {
                return false;
            }
        }
        return k === segments.length;
    };
    JSONLocation.prototype.toString = function () {
        return '[' + this.segments.join('][') + ']';
    };
    return JSONLocation;
})();
exports.JSONLocation = JSONLocation;
});

var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};

ace.define("ace/mode/json/jsonParser",["require","exports","module","ace/mode/json/json","ace/mode/json/jsonLocation"], function (require, exports) {
'use strict';

var Json = require('./json')
var jsonLocation_1 = require('./jsonLocation')

function isNumber(obj) {
    if ((typeof (obj) === 'number' || obj instanceof Number) && !isNaN(obj)) {
        return true;
    }
    return false;
}

function isUndefined(obj) {
    return typeof (obj) === 'undefined';
}

function isObject(obj) {
    if (typeof obj === 'undefined' || obj === null) {
        return false;
    }
    return Object.prototype.toString.call(obj) === '[object Object]';
}

function contains(array, item) {
    return array.indexOf(item) >= 0;
}

function localize(info, message) {
    var args = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        args[_i - 2] = arguments[_i];
    }
    return message.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] !== 'undefined' ? args[number] : match; });
}

var ASTNode = (function () {
    function ASTNode(parent, type, name, start, end) {
        this.type = type;
        this.name = name;
        this.start = start;
        this.end = end;
        this.parent = parent;
    }
    ASTNode.prototype.getNodeLocation = function () {
        var path = this.parent ? this.parent.getNodeLocation() : new jsonLocation_1.JSONLocation([]);
        if (this.name) {
            path = path.append(this.name);
        }
        return path;
    };
    ASTNode.prototype.getChildNodes = function () {
        return [];
    };
    ASTNode.prototype.getValue = function () {
        return;
    };
    ASTNode.prototype.contains = function (offset, includeRightBound) {
        if (includeRightBound === void 0) { includeRightBound = false; }
        return offset >= this.start && offset < this.end || includeRightBound && offset === this.end;
    };
    ASTNode.prototype.visit = function (visitor) {
        return visitor(this);
    };
    ASTNode.prototype.getNodeFromOffset = function (offset) {
        var findNode = function (node) {
            if (offset >= node.start && offset < node.end) {
                var children = node.getChildNodes();
                for (var i = 0; i < children.length && children[i].start <= offset; i++) {
                    var item = findNode(children[i]);
                    if (item) {
                        return item;
                    }
                }
                return node;
            }
            return null;
        };
        return findNode(this);
    };
    ASTNode.prototype.getNodeFromOffsetEndInclusive = function (offset) {
        var findNode = function (node) {
            if (offset >= node.start && offset <= node.end) {
                var children = node.getChildNodes();
                for (var i = 0; i < children.length && children[i].start <= offset; i++) {
                    var item = findNode(children[i]);
                    if (item) {
                        return item;
                    }
                }
                return node;
            }
            return null;
        };
        return findNode(this);
    };
    ASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        var _this = this;
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        if (Array.isArray(schema.type)) {
            if (contains(schema.type, this.type) === false) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('typeArrayMismatchWarning', 'Incorrect type. Expected one of {0}', schema.type.join())
                });
            }
        }
        else if (schema.type) {
            if (this.type !== schema.type) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('typeMismatchWarning', 'Incorrect type. Expected "{0}"', schema.type)
                });
            }
        }
        if (Array.isArray(schema.allOf)) {
            schema.allOf.forEach(function (subSchema) {
                _this.validate(subSchema, validationResult, matchingSchemas, offset);
            });
        }
        if (schema.not) {
            var subValidationResult = new ValidationResult();
            var subMatchingSchemas = [];
            this.validate(schema.not, subValidationResult, subMatchingSchemas, offset);
            if (!subValidationResult.hasErrors()) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('notSchemaWarning', "Matches a schema that is not allowed.")
                });
            }
            if (matchingSchemas) {
                subMatchingSchemas.forEach(function (ms) {
                    ms.inverted = !ms.inverted;
                    matchingSchemas.push(ms);
                });
            }
        }
        var testAlternatives = function (alternatives, maxOneMatch) {
            var matches = [];
            var bestMatch = null;
            alternatives.forEach(function (subSchema) {
                var subValidationResult = new ValidationResult();
                var subMatchingSchemas = [];
                _this.validate(subSchema, subValidationResult, subMatchingSchemas);
                if (!subValidationResult.hasErrors()) {
                    matches.push(subSchema);
                }
                if (!bestMatch) {
                    bestMatch = { schema: subSchema, validationResult: subValidationResult, matchingSchemas: subMatchingSchemas };
                }
                else {
                    if (!maxOneMatch && !subValidationResult.hasErrors() && !bestMatch.validationResult.hasErrors()) {
                        bestMatch.matchingSchemas.push.apply(bestMatch.matchingSchemas, subMatchingSchemas);
                        bestMatch.validationResult.propertiesMatches += subValidationResult.propertiesMatches;
                        bestMatch.validationResult.propertiesValueMatches += subValidationResult.propertiesValueMatches;
                    }
                    else {
                        var compareResult = subValidationResult.compare(bestMatch.validationResult);
                        if (compareResult > 0) {
                            bestMatch = { schema: subSchema, validationResult: subValidationResult, matchingSchemas: subMatchingSchemas };
                        }
                        else if (compareResult === 0) {
                            bestMatch.matchingSchemas.push.apply(bestMatch.matchingSchemas, subMatchingSchemas);
                        }
                    }
                }
            });
            if (matches.length > 1 && maxOneMatch) {
                validationResult.warnings.push({
                    location: { start: _this.start, end: _this.start + 1 },
                    message: localize('oneOfWarning', "Matches multiple schemas when only one must validate.")
                });
            }
            if (bestMatch !== null) {
                validationResult.merge(bestMatch.validationResult);
                validationResult.propertiesMatches += bestMatch.validationResult.propertiesMatches;
                validationResult.propertiesValueMatches += bestMatch.validationResult.propertiesValueMatches;
                if (matchingSchemas) {
                    matchingSchemas.push.apply(matchingSchemas, bestMatch.matchingSchemas);
                }
            }
            return matches.length;
        };
        if (Array.isArray(schema.anyOf)) {
            testAlternatives(schema.anyOf, false);
        }
        if (Array.isArray(schema.oneOf)) {
            testAlternatives(schema.oneOf, true);
        }
        if (Array.isArray(schema.enum)) {
            if (contains(schema.enum, this.getValue()) === false) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('enumWarning', 'Value is not an accepted value. Valid values: {0}', JSON.stringify(schema.enum))
                });
            }
            else {
                validationResult.enumValueMatch = true;
            }
        }
        if (matchingSchemas !== null) {
            matchingSchemas.push({ node: this, schema: schema });
        }
    };
    return ASTNode;
})();
exports.ASTNode = ASTNode;
var NullASTNode = (function (_super) {
    __extends(NullASTNode, _super);
    function NullASTNode(parent, name, start, end) {
        _super.call(this, parent, 'null', name, start, end);
    }
    NullASTNode.prototype.getValue = function () {
        return null;
    };
    return NullASTNode;
})(ASTNode);
exports.NullASTNode = NullASTNode;
var BooleanASTNode = (function (_super) {
    __extends(BooleanASTNode, _super);
    function BooleanASTNode(parent, name, value, start, end) {
        _super.call(this, parent, 'boolean', name, start, end);
        this.value = value;
    }
    BooleanASTNode.prototype.getValue = function () {
        return this.value;
    };
    return BooleanASTNode;
})(ASTNode);
exports.BooleanASTNode = BooleanASTNode;
var ArrayASTNode = (function (_super) {
    __extends(ArrayASTNode, _super);
    function ArrayASTNode(parent, name, start, end) {
        _super.call(this, parent, 'array', name, start, end);
        this.items = [];
    }
    ArrayASTNode.prototype.getChildNodes = function () {
        return this.items;
    };
    ArrayASTNode.prototype.getValue = function () {
        return this.items.map(function (v) { return v.getValue(); });
    };
    ArrayASTNode.prototype.addItem = function (item) {
        if (item) {
            this.items.push(item);
            return true;
        }
        return false;
    };
    ArrayASTNode.prototype.visit = function (visitor) {
        var ctn = visitor(this);
        for (var i = 0; i < this.items.length && ctn; i++) {
            ctn = this.items[i].visit(visitor);
        }
        return ctn;
    };
    ArrayASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        var _this = this;
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        _super.prototype.validate.call(this, schema, validationResult, matchingSchemas, offset);
        if (Array.isArray(schema.items)) {
            var subSchemas = schema.items;
            subSchemas.forEach(function (subSchema, index) {
                var itemValidationResult = new ValidationResult();
                var item = _this.items[index];
                if (item) {
                    item.validate(subSchema, itemValidationResult, matchingSchemas, offset);
                    validationResult.mergePropertyMatch(itemValidationResult);
                }
                else if (_this.items.length >= schema.items.length) {
                    validationResult.propertiesValueMatches++;
                }
            });
            if (schema.additionalItems === false && this.items.length > subSchemas.length) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('additionalItemsWarning', 'Array has too many items according to schema. Expected {0} or fewer', subSchemas.length)
                });
            }
            else if (this.items.length >= schema.items.length) {
                validationResult.propertiesValueMatches += (this.items.length - schema.items.length);
            }
        }
        else if (schema.items) {
            this.items.forEach(function (item) {
                var itemValidationResult = new ValidationResult();
                item.validate(schema.items, itemValidationResult, matchingSchemas, offset);
                validationResult.mergePropertyMatch(itemValidationResult);
            });
        }
        if (schema.minItems && this.items.length < schema.minItems) {
            validationResult.warnings.push({
                location: { start: this.start, end: this.end },
                message: localize('minItemsWarning', 'Array has too few items. Expected {0} or more', schema.minItems)
            });
        }
        if (schema.maxItems && this.items.length > schema.maxItems) {
            validationResult.warnings.push({
                location: { start: this.start, end: this.end },
                message: localize('maxItemsWarning', 'Array has too many items. Expected {0} or fewer', schema.minItems)
            });
        }
        if (schema.uniqueItems === true) {
            var values = this.items.map(function (node) {
                return node.getValue();
            });
            var duplicates = values.some(function (value, index) {
                return index !== values.lastIndexOf(value);
            });
            if (duplicates) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('uniqueItemsWarning', 'Array has duplicate items')
                });
            }
        }
    };
    return ArrayASTNode;
})(ASTNode);
exports.ArrayASTNode = ArrayASTNode;
var NumberASTNode = (function (_super) {
    __extends(NumberASTNode, _super);
    function NumberASTNode(parent, name, start, end) {
        _super.call(this, parent, 'number', name, start, end);
        this.isInteger = true;
        this.value = Number.NaN;
    }
    NumberASTNode.prototype.getValue = function () {
        return this.value;
    };
    NumberASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        var typeIsInteger = false;
        if (schema.type === 'integer' || (Array.isArray(schema.type) && contains(schema.type, 'integer'))) {
            typeIsInteger = true;
        }
        if (typeIsInteger && this.isInteger === true) {
            this.type = 'integer';
        }
        _super.prototype.validate.call(this, schema, validationResult, matchingSchemas, offset);
        this.type = 'number';
        var val = this.getValue();
        if (isNumber(schema.multipleOf)) {
            if (val % schema.multipleOf !== 0) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('multipleOfWarning', 'Value is not divisible by {0}', schema.multipleOf)
                });
            }
        }
        if (!isUndefined(schema.minimum)) {
            if (schema.exclusiveMinimum && val <= schema.minimum) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('exclusiveMinimumWarning', 'Value is below the exclusive minimum of {0}', schema.minimum)
                });
            }
            if (!schema.exclusiveMinimum && val < schema.minimum) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('minimumWarning', 'Value is below the minimum of {0}', schema.minimum)
                });
            }
        }
        if (!isUndefined(schema.maximum)) {
            if (schema.exclusiveMaximum && val >= schema.maximum) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('exclusiveMaximumWarning', 'Value is above the exclusive maximum of {0}', schema.maximum)
                });
            }
            if (!schema.exclusiveMaximum && val > schema.maximum) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('maximumWarning', 'Value is above the maximum of {0}', schema.maximum)
                });
            }
        }
    };
    return NumberASTNode;
})(ASTNode);
exports.NumberASTNode = NumberASTNode;
var StringASTNode = (function (_super) {
    __extends(StringASTNode, _super);
    function StringASTNode(parent, name, isKey, start, end) {
        this.isKey = isKey;
        this.value = '';
        _super.call(this, parent, 'string', name, start, end);
    }
    StringASTNode.prototype.getValue = function () {
        return this.value;
    };
    StringASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        _super.prototype.validate.call(this, schema, validationResult, matchingSchemas, offset);
        if (schema.minLength && this.value.length < schema.minLength) {
            validationResult.warnings.push({
                location: { start: this.start, end: this.end },
                message: localize('minLengthWarning', 'String is shorter than the minimum length of ', schema.minLength)
            });
        }
        if (schema.maxLength && this.value.length > schema.maxLength) {
            validationResult.warnings.push({
                location: { start: this.start, end: this.end },
                message: localize('maxLengthWarning', 'String is shorter than the maximum length of ', schema.maxLength)
            });
        }
        if (schema.pattern) {
            var regex = new RegExp(schema.pattern);
            if (!regex.test(this.value)) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: schema.errorMessage || localize('patternWarning', 'String does not match the pattern of "{0}"', schema.pattern)
                });
            }
        }
    };
    return StringASTNode;
})(ASTNode);
exports.StringASTNode = StringASTNode;
var PropertyASTNode = (function (_super) {
    __extends(PropertyASTNode, _super);
    function PropertyASTNode(parent, key) {
        _super.call(this, parent, 'property', null, key.start);
        this.key = key;
        key.parent = this;
        key.name = key.value;
        this.colonOffset = -1;
    }
    PropertyASTNode.prototype.getChildNodes = function () {
        return this.value ? [this.key, this.value] : [this.key];
    };
    PropertyASTNode.prototype.setValue = function (value) {
        this.value = value;
        return value !== null;
    };
    PropertyASTNode.prototype.visit = function (visitor) {
        return visitor(this) && this.key.visit(visitor) && this.value && this.value.visit(visitor);
    };
    PropertyASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        if (this.value) {
            this.value.validate(schema, validationResult, matchingSchemas, offset);
        }
    };
    return PropertyASTNode;
})(ASTNode);
exports.PropertyASTNode = PropertyASTNode;
var ObjectASTNode = (function (_super) {
    __extends(ObjectASTNode, _super);
    function ObjectASTNode(parent, name, start, end) {
        _super.call(this, parent, 'object', name, start, end);
        this.properties = [];
    }
    ObjectASTNode.prototype.getChildNodes = function () {
        return this.properties;
    };
    ObjectASTNode.prototype.addProperty = function (node) {
        if (!node) {
            return false;
        }
        this.properties.push(node);
        return true;
    };
    ObjectASTNode.prototype.getFirstProperty = function (key) {
        for (var i = 0; i < this.properties.length; i++) {
            if (this.properties[i].key.value === key) {
                return this.properties[i];
            }
        }
        return null;
    };
    ObjectASTNode.prototype.getKeyList = function () {
        return this.properties.map(function (p) { return p.key.getValue(); });
    };
    ObjectASTNode.prototype.getValue = function () {
        var value = {};
        this.properties.forEach(function (p) {
            var v = p.value && p.value.getValue();
            if (v) {
                value[p.key.getValue()] = v;
            }
        });
        return value;
    };
    ObjectASTNode.prototype.visit = function (visitor) {
        var ctn = visitor(this);
        for (var i = 0; i < this.properties.length && ctn; i++) {
            ctn = this.properties[i].visit(visitor);
        }
        return ctn;
    };
    ObjectASTNode.prototype.validate = function (schema, validationResult, matchingSchemas, offset) {
        var _this = this;
        if (offset === void 0) { offset = -1; }
        if (offset !== -1 && !this.contains(offset)) {
            return;
        }
        _super.prototype.validate.call(this, schema, validationResult, matchingSchemas, offset);
        var seenKeys = {};
        var unprocessedProperties = [];
        this.properties.forEach(function (node) {
            var key = node.key.value;
            seenKeys[key] = node.value;
            unprocessedProperties.push(key);
        });
        if (Array.isArray(schema.required)) {
            schema.required.forEach(function (propertyName) {
                if (!seenKeys[propertyName]) {
                    var key = _this.parent && _this.parent && _this.parent.key;
                    var location = key ? { start: key.start, end: key.end } : { start: _this.start, end: _this.start + 1 };
                    validationResult.warnings.push({
                        location: location,
                        message: localize('MissingRequiredPropWarning', 'Missing property "{0}"', propertyName)
                    });
                }
            });
        }
        var propertyProcessed = function (prop) {
            var index = unprocessedProperties.indexOf(prop);
            while (index >= 0) {
                unprocessedProperties.splice(index, 1);
                index = unprocessedProperties.indexOf(prop);
            }
        };
        if (schema.properties) {
            Object.keys(schema.properties).forEach(function (propertyName) {
                propertyProcessed(propertyName);
                var prop = schema.properties[propertyName];
                var child = seenKeys[propertyName];
                if (child) {
                    var propertyvalidationResult = new ValidationResult();
                    child.validate(prop, propertyvalidationResult, matchingSchemas, offset);
                    validationResult.mergePropertyMatch(propertyvalidationResult);
                }
            });
        }
        if (schema.patternProperties) {
            Object.keys(schema.patternProperties).forEach(function (propertyPattern) {
                var regex = new RegExp(propertyPattern);
                unprocessedProperties.slice(0).forEach(function (propertyName) {
                    if (regex.test(propertyName)) {
                        propertyProcessed(propertyName);
                        var child = seenKeys[propertyName];
                        if (child) {
                            var propertyvalidationResult = new ValidationResult();
                            child.validate(schema.patternProperties[propertyPattern], propertyvalidationResult, matchingSchemas, offset);
                            validationResult.mergePropertyMatch(propertyvalidationResult);
                        }
                    }
                });
            });
        }
        if (isObject(schema.additionalProperties)) {
            unprocessedProperties.forEach(function (propertyName) {
                var child = seenKeys[propertyName];
                if (child) {
                    var propertyvalidationResult = new ValidationResult();
                    child.validate(schema.additionalProperties, propertyvalidationResult, matchingSchemas, offset);
                    validationResult.mergePropertyMatch(propertyvalidationResult);
                }
            });
        }
        else if (schema.additionalProperties === false) {
            if (unprocessedProperties.length > 0) {
                unprocessedProperties.forEach(function (propertyName) {
                    var child = seenKeys[propertyName];
                    if (child) {
                        var propertyNode = child.parent;
                        validationResult.warnings.push({
                            location: { start: propertyNode.key.start, end: propertyNode.key.end },
                            message: localize('DisallowedExtraPropWarning', 'Property {0} is not allowed', propertyName)
                        });
                    }
                });
            }
        }
        if (schema.maxProperties) {
            if (this.properties.length > schema.maxProperties) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('MaxPropWarning', 'Object has more properties than limit of {0}', schema.maxProperties)
                });
            }
        }
        if (schema.minProperties) {
            if (this.properties.length < schema.minProperties) {
                validationResult.warnings.push({
                    location: { start: this.start, end: this.end },
                    message: localize('MinPropWarning', 'Object has fewer properties than the required number of {0}', schema.minProperties)
                });
            }
        }
        if (isObject(schema.dependencies)) {
            Object.keys(schema.dependencies).forEach(function (key) {
                var prop = seenKeys[key];
                if (prop) {
                    if (Array.isArray(schema.dependencies[key])) {
                        var valueAsArray = schema.dependencies[key];
                        valueAsArray.forEach(function (requiredProp) {
                            if (!seenKeys[requiredProp]) {
                                validationResult.warnings.push({
                                    location: { start: _this.start, end: _this.end },
                                    message: localize('RequiredDependentPropWarning', 'Object is missing property {0} required by property {1}', requiredProp, key)
                                });
                            }
                            else {
                                validationResult.propertiesValueMatches++;
                            }
                        });
                    }
                    else if (isObject(schema.dependencies[key])) {
                        var valueAsSchema = schema.dependencies[key];
                        var propertyvalidationResult = new ValidationResult();
                        _this.validate(valueAsSchema, propertyvalidationResult, matchingSchemas, offset);
                        validationResult.mergePropertyMatch(propertyvalidationResult);
                    }
                }
            });
        }
    };
    return ObjectASTNode;
})(ASTNode);
exports.ObjectASTNode = ObjectASTNode;
var JSONDocumentConfig = (function () {
    function JSONDocumentConfig() {
        this.ignoreDanglingComma = false;
    }
    return JSONDocumentConfig;
})();
exports.JSONDocumentConfig = JSONDocumentConfig;
var ValidationResult = (function () {
    function ValidationResult() {
        this.errors = [];
        this.warnings = [];
        this.propertiesMatches = 0;
        this.propertiesValueMatches = 0;
        this.enumValueMatch = false;
    }
    ValidationResult.prototype.hasErrors = function () {
        return !!this.errors.length || !!this.warnings.length;
    };
    ValidationResult.prototype.mergeAll = function (validationResults) {
        var _this = this;
        validationResults.forEach(function (validationResult) {
            _this.merge(validationResult);
        });
    };
    ValidationResult.prototype.merge = function (validationResult) {
        this.errors = this.errors.concat(validationResult.errors);
        this.warnings = this.warnings.concat(validationResult.warnings);
    };
    ValidationResult.prototype.mergePropertyMatch = function (propertyValidationResult) {
        this.merge(propertyValidationResult);
        this.propertiesMatches++;
        if (propertyValidationResult.enumValueMatch || !propertyValidationResult.hasErrors() && propertyValidationResult.propertiesMatches) {
            this.propertiesValueMatches++;
        }
    };
    ValidationResult.prototype.compare = function (other) {
        var hasErrors = this.hasErrors();
        if (hasErrors !== other.hasErrors()) {
            return hasErrors ? -1 : 1;
        }
        if (this.enumValueMatch !== other.enumValueMatch) {
            return other.enumValueMatch ? -1 : 1;
        }
        if (this.propertiesValueMatches !== other.propertiesValueMatches) {
            return this.propertiesValueMatches - other.propertiesValueMatches;
        }
        return this.propertiesMatches - other.propertiesMatches;
    };
    return ValidationResult;
})();
exports.ValidationResult = ValidationResult;
var JSONDocument = (function () {
    function JSONDocument(config) {
        this.config = config;
        this.validationResult = new ValidationResult();
    }
    Object.defineProperty(JSONDocument.prototype, "errors", {
        get: function () {
            return this.validationResult.errors;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(JSONDocument.prototype, "warnings", {
        get: function () {
            return this.validationResult.warnings;
        },
        enumerable: true,
        configurable: true
    });
    JSONDocument.prototype.getNodeFromOffset = function (offset) {
        return this.root && this.root.getNodeFromOffset(offset);
    };
    JSONDocument.prototype.getNodeFromOffsetEndInclusive = function (offset) {
        return this.root && this.root.getNodeFromOffsetEndInclusive(offset);
    };
    JSONDocument.prototype.visit = function (visitor) {
        if (this.root) {
            this.root.visit(visitor);
        }
    };
    JSONDocument.prototype.validate = function (schema, matchingSchemas, offset) {
        if (matchingSchemas === void 0) { matchingSchemas = null; }
        if (offset === void 0) { offset = -1; }
        if (this.root) {
            this.root.validate(schema, this.validationResult, matchingSchemas, offset);
        }
    };
    return JSONDocument;
})();
exports.JSONDocument = JSONDocument;
var JSONParser = (function () {
    function JSONParser() {
    }
    JSONParser.prototype.parse = function (text, config) {
        if (config === void 0) { config = new JSONDocumentConfig(); }
        var _doc = new JSONDocument(config);
        var _scanner = Json.createScanner(text, true);
        function _accept(token) {
            if (_scanner.getToken() === token) {
                _scanner.scan();
                return true;
            }
            return false;
        }
        function _error(message, node, skipUntilAfter, skipUntil) {
            if (node === void 0) { node = null; }
            if (skipUntilAfter === void 0) { skipUntilAfter = []; }
            if (skipUntil === void 0) { skipUntil = []; }
            if (_doc.errors.length === 0 || _doc.errors[0].location.start !== _scanner.getTokenOffset()) {
                var error = { message: message, location: { start: _scanner.getTokenOffset(), end: _scanner.getTokenOffset() + _scanner.getTokenLength() } };
                _doc.errors.push(error);
            }
            if (node) {
                _finalize(node, false);
            }
            if (skipUntilAfter.length + skipUntil.length > 0) {
                var token = _scanner.getToken();
                while (token !== Json.SyntaxKind.EOF) {
                    if (skipUntilAfter.indexOf(token) !== -1) {
                        _scanner.scan();
                        break;
                    }
                    else if (skipUntil.indexOf(token) !== -1) {
                        break;
                    }
                    token = _scanner.scan();
                }
            }
            return node;
        }
        function _checkScanError() {
            switch (_scanner.getTokenError()) {
                case Json.ScanError.InvalidUnicode:
                    _error(localize('InvalidUnicode', 'Invalid unicode sequence in string'));
                    return true;
                case Json.ScanError.InvalidEscapeCharacter:
                    _error(localize('InvalidEscapeCharacter', 'Invalid escape character in string'));
                    return true;
                case Json.ScanError.UnexpectedEndOfNumber:
                    _error(localize('UnexpectedEndOfNumber', 'Unexpected end of number'));
                    return true;
                case Json.ScanError.UnexpectedEndOfComment:
                    _error(localize('UnexpectedEndOfComment', 'Unexpected end of comment'));
                    return true;
                case Json.ScanError.UnexpectedEndOfString:
                    _error(localize('UnexpectedEndOfString', 'Unexpected end of string'));
                    return true;
            }
            return false;
        }
        function _finalize(node, scanNext) {
            node.end = _scanner.getTokenOffset() + _scanner.getTokenLength();
            if (scanNext) {
                _scanner.scan();
            }
            return node;
        }
        function _parseArray(parent, name) {
            if (_scanner.getToken() !== Json.SyntaxKind.OpenBracketToken) {
                return null;
            }
            var node = new ArrayASTNode(parent, name, _scanner.getTokenOffset());
            _scanner.scan(); // consume OpenBracketToken
            var count = 0;
            if (node.addItem(_parseValue(node, '' + count++))) {
                while (_accept(Json.SyntaxKind.CommaToken)) {
                    if (!node.addItem(_parseValue(node, '' + count++)) && !_doc.config.ignoreDanglingComma) {
                        _error(localize('ValueExpected', 'Value expected'));
                    }
                }
            }
            if (_scanner.getToken() !== Json.SyntaxKind.CloseBracketToken) {
                return _error(localize('ExpectedCloseBracket', 'Expected comma or closing bracket'), node);
            }
            return _finalize(node, true);
        }
        function _parseProperty(parent, keysSeen) {
            var key = _parseString(null, null, true);
            if (!key) {
                if (_scanner.getToken() === Json.SyntaxKind.Unknown) {
                    var value = _scanner.getTokenValue();
                    if (value.length > 0 && (value.charAt(0) === '\'' || Json.isLetter(value.charAt(0).charCodeAt(0)))) {
                        _error(localize('DoubleQuotesExpected', 'Property keys must be doublequoted'));
                    }
                }
                return null;
            }
            var node = new PropertyASTNode(parent, key);
            if (keysSeen[key.value]) {
                _doc.warnings.push({ location: { start: node.key.start, end: node.key.end }, message: localize('DuplicateKeyWarning', "Duplicate object key") });
            }
            keysSeen[key.value] = true;
            if (_scanner.getToken() === Json.SyntaxKind.ColonToken) {
                node.colonOffset = _scanner.getTokenOffset();
            }
            else {
                return _error(localize('ColonExpected', 'Colon expected'), node, [], [Json.SyntaxKind.CloseBraceToken, Json.SyntaxKind.CommaToken]);
            }
            _scanner.scan(); // consume ColonToken
            if (!node.setValue(_parseValue(node, key.value))) {
                return _error(localize('ValueExpected', 'Value expected'), node, [], [Json.SyntaxKind.CloseBraceToken, Json.SyntaxKind.CommaToken]);
            }
            node.end = node.value.end;
            return node;
        }
        function _parseObject(parent, name) {
            if (_scanner.getToken() !== Json.SyntaxKind.OpenBraceToken) {
                return null;
            }
            var node = new ObjectASTNode(parent, name, _scanner.getTokenOffset());
            _scanner.scan(); // consume OpenBraceToken
            var keysSeen = {};
            if (node.addProperty(_parseProperty(node, keysSeen))) {
                while (_accept(Json.SyntaxKind.CommaToken)) {
                    if (!node.addProperty(_parseProperty(node, keysSeen)) && !_doc.config.ignoreDanglingComma) {
                        _error(localize('PropertyExpected', 'Property expected'));
                    }
                }
            }
            if (_scanner.getToken() !== Json.SyntaxKind.CloseBraceToken) {
                return _error(localize('ExpectedCloseBrace', 'Expected comma or closing brace'), node);
            }
            return _finalize(node, true);
        }
        function _parseString(parent, name, isKey) {
            if (_scanner.getToken() !== Json.SyntaxKind.StringLiteral) {
                return null;
            }
            var node = new StringASTNode(parent, name, isKey, _scanner.getTokenOffset());
            node.value = _scanner.getTokenValue();
            _checkScanError();
            return _finalize(node, true);
        }
        function _parseNumber(parent, name) {
            if (_scanner.getToken() !== Json.SyntaxKind.NumericLiteral) {
                return null;
            }
            var node = new NumberASTNode(parent, name, _scanner.getTokenOffset());
            if (!_checkScanError()) {
                var tokenValue = _scanner.getTokenValue();
                try {
                    var numberValue = JSON.parse(tokenValue);
                    if (typeof numberValue !== 'number') {
                        return _error(localize('InvalidNumberFormat', 'Invalid number format'), node);
                    }
                    node.value = numberValue;
                }
                catch (e) {
                    return _error(localize('InvalidNumberFormat', 'Invalid number format'), node);
                }
                node.isInteger = tokenValue.indexOf('.') === -1;
            }
            return _finalize(node, true);
        }
        function _parseLiteral(parent, name) {
            var node;
            switch (_scanner.getToken()) {
                case Json.SyntaxKind.NullKeyword:
                    node = new NullASTNode(parent, name, _scanner.getTokenOffset());
                    break;
                case Json.SyntaxKind.TrueKeyword:
                    node = new BooleanASTNode(parent, name, true, _scanner.getTokenOffset());
                    break;
                case Json.SyntaxKind.FalseKeyword:
                    node = new BooleanASTNode(parent, name, false, _scanner.getTokenOffset());
                    break;
                default:
                    return null;
            }
            return _finalize(node, true);
        }
        function _parseValue(parent, name) {
            return _parseArray(parent, name) || _parseObject(parent, name) || _parseString(parent, name, false) || _parseNumber(parent, name) || _parseLiteral(parent, name);
        }
        _scanner.scan();
        _doc.root = _parseValue(null, null);
        if (!_doc.root) {
            _error(localize('Invalid symbol', 'Expected a JSON object, array or literal'));
        }
        else if (_scanner.getToken() !== Json.SyntaxKind.EOF) {
            _error(localize('End of file expected', 'End of file expected'));
        }
        return _doc;
    };
    return JSONParser;
})();
exports.JSONParser = JSONParser;
});

ace.define("ace/mode/json/jsonIntellisense",["require","exports","module"], function(require, exports, module) {
"use strict";

var JsonIntellisense = function() {
};

(function() {
    this.suggest = function (jsonDocument, jsonSchema, doc, pos, prefix, callback) {
        var suggestions = [];
        var result = {
            currentWord: prefix,
            incomplete: false,
            suggestions: []
        };

        var overwriteBefore
        var overwriteAfter
        var proposed = {}
        var collector = {
            add: function (suggestion) {
                if (!proposed[suggestion.caption]) {
                    proposed[suggestion.caption] = true;

                    suggestion.overwriteBefore = overwriteBefore;
                    suggestion.overwriteAfter = overwriteAfter;
                    suggestions.push(suggestion);
                }
            }
        };

        var offset = doc.positionToIndex(pos)
        var node = jsonDocument.getNodeFromOffsetEndInclusive(offset)
        var addValue = true;
        var currentKey = prefix;
        var currentProperty = null;
        if (node && node.type === 'string') {
            var stringNode = node;
            if (stringNode.isKey) {
                overwriteBefore = offset - node.start - prefix.length
                overwriteAfter = node.end - offset
                addValue = !(node.parent && node.parent.value);
                currentProperty = node.parent ? node.parent : null;
                currentKey = stringNode.value
                if (node.parent) {
                    node = node.parent.parent;
                }
            }
        }
        if (node && node.type === 'object' && node.start !== offset) {
            var properties = node.properties;
            properties.forEach(function (p) {
                if (!currentProperty || currentProperty !== p) {
                    proposed[p.key.value] = true;
                }
            });
            if (jsonSchema) {
                var isLast = properties.length === 0 || offset >= properties[properties.length - 1].start;
                this.getPropertySuggestions(jsonSchema, jsonDocument, node, currentKey, addValue, isLast, collector);
            } else if (node.parent) {
            }
        }
        if (node && (node.type === 'string' || node.type === 'number' || node.type === 'integer' || node.type === 'boolean' || node.type === 'null')) {
            overwriteBefore = offset - node.start - prefix.length
            overwriteAfter = node.end - offset
            node = node.parent;
        }

        if (jsonSchema) {
            this.getValueSuggestions(jsonSchema, jsonDocument, node, offset, collector);
        } else {
        }
        callback(suggestions)
    }

    this.getPropertySuggestions = function (jsonSchema, jsonDocument, node, currentKey, addValue, isLast, collector) {
        var matchingSchemas = [],
            that = this;
        jsonDocument.validate(jsonSchema, matchingSchemas, node.start)

        matchingSchemas.forEach(function (s) {
            if (s.node === node && !s.inverted) {
                var schemaProperties = s.schema.properties;
                if (schemaProperties) {
                    for (var key in schemaProperties) {
                        var propertySchema = schemaProperties[key];
                        var codeSnippet = that.getSnippetForProperty(key, propertySchema, addValue, isLast) || ''
                        collector.add({
                            caption: key,
                            meta: 'property',
                            label: key,
                            snippet: codeSnippet,
                            docHTML: propertySchema.description
                        });
                    }
                }
            }
        });
    }

    this.getValueSuggestions = function (jsonSchema, jsonDocument, node, offset, collector) {
        if (!node) {
            this.addDefaultSuggestion(jsonSchema, collector);
        } else {
            var parentKey = null;
            if (node && (node.type === 'property') && offset > node.colonOffset) {
                var valueNode = node.value;
                if (valueNode && offset > valueNode.end) {
                    return; // we are past the value node
                }
                parentKey = node.key.value;
                node = node.parent;
            }
            if (node && (parentKey !== null || node.type === 'array')) {
                var matchingSchemas = [],
                    that = this;
                jsonDocument.validate(jsonSchema, matchingSchemas, node.start);

                matchingSchemas.forEach(function (s) {
                    if (s.node === node && !s.inverted && s.schema) {
                        if (s.schema.items) {
                            that.addDefaultSuggestion(s.schema.items, collector);
                            that.addEnumSuggestion(s.schema.items, collector);
                        }
                        if (s.schema.properties) {
                            var propertySchema = s.schema.properties[parentKey];
                            if (propertySchema) {
                                that.addDefaultSuggestion(propertySchema, collector);
                                that.addEnumSuggestion(propertySchema, collector);
                            }
                        }
                    }
                });

            }
        }
    }

    this.addBooleanSuggestion = function (value, collector) {
        collector.add({
            caption: value ? 'true' : 'false',
            meta: this.getSuggestionType('boolean'),
            snippet: this.getSnippetForValue(value),
            docHTML: ''
        });
    };

    this.addEnumSuggestion = function (schema, collector) {
        var that = this;
        if (Array.isArray(schema.enum)) {
            schema.enum.forEach(function (enm) {
                collector.add({
                    caption: that.getLabelForValue(enm),
                    meta: that.getSuggestionType(schema.type),
                    snippet: that.getSnippetForValue(enm),
                    docHTML: ''
                });
            })
        } else if (schema.type === 'boolean') {
            this.addBooleanSuggestion(true, collector);
            this.addBooleanSuggestion(false, collector);
        }
        if (Array.isArray(schema.allOf)) {
            schema.allOf.forEach(function (s) { that.addEnumSuggestion(s, collector) });
        }
        if (Array.isArray(schema.anyOf)) {
            schema.anyOf.forEach(function (s) { that.addEnumSuggestion(s, collector) });
        }
        if (Array.isArray(schema.oneOf)) {
            schema.oneOf.forEach(function (s) { that.addEnumSuggestion(s, collector) });
        }
    }

    this.addDefaultSuggestion = function (schema, collector) {
        var that = this;
        if (schema.default) {
            collector.add({
                caption: that.getLabelForValue(schema.default),
                meta: 'Default value',
                snippet: that.getSnippetForValue(schema.default),
            });
        }
        if (Array.isArray(schema.allOf)) {
            schema.allOf.forEach(function (s) { that.addDefaultSuggestion(s, collector) });
        }
        if (Array.isArray(schema.anyOf)) {
            schema.anyOf.forEach(function (s) { that.addDefaultSuggestion(s, collector) });
        }
        if (Array.isArray(schema.oneOf)) {
            schema.oneOf.forEach(function (s) { that.addDefaultSuggestion(s, collector) });
        }
    }

    this.getLabelForValue = function (value) {
        var label = JSON.stringify(value);
        if (label.length > 57) {
            return label.substr(0, 57).trim() + '...';
        }
        return label;
    }

    this.getSnippetForProperty = function (key, propertySchema, addValue, isLast) {
        var result = '"' + key + '"';
        if (!addValue) {
            return result;
        }
        result += ': ';

        var defaultVal = propertySchema.default;
        if (typeof (defaultVal) != "undefined") {
            result += this.getSnippetForValue(defaultVal);
        } else if (propertySchema.enum && propertySchema.enum.length > 0) {
            result += this.getSnippetForValue(propertySchema.enum[0]);
        } else {
            switch (propertySchema.type) {
                case 'boolean':
                    result += '${0:false}';
                    break;
                case 'string':
                    result += '"${0}"';
                    break;
                case 'object':
                    result += '{\n\t${0}\n}';
                    break;
                case 'array':
                    result += '[\n\t${0}\n]';
                    break;
                case 'number':
                case 'integer':
                    result += '${0:0}';
                    break;
                case 'null':
                    result += 'null';
                    break;
                default:
                    return result;
            }
        }
        if (!isLast) {
            result += ',';
        }
        return result;
    }

    this.getSnippetForValue = function (value) {
        var snippet = JSON.stringify(value, null, '\t');
        switch (typeof value) {
            case 'object':
                if (value === null) {
                    return '${0:null}';
                }
                return snippet;
            case 'string':
                return '"${0:' + snippet.substr(1, snippet.length - 2) + '}"';
            case 'number':
            case 'integer':
            case 'boolean':
                return '${0:' + snippet + '}';
        }
        return snippet;
    }

    this.getSuggestionType = function (type) {
        if (Array.isArray(type)) {
            var array = type;
            type = array.length > 0 ? array[0] : null;
        }
        if (!type) {
            return 'text';
        }
        switch (type) {
            case 'string': return 'text';
            case 'object': return 'module';
            case 'property': return 'property';
            default: return 'value';
        }
    }

}).call(JsonIntellisense.prototype);

exports.JsonIntellisense = JsonIntellisense;

});

ace.define("ace/mode/json_worker",["require","exports","module","ace/lib/oop","ace/worker/mirror","ace/mode/json/jsonParser","ace/mode/json/json","ace/mode/json/jsonIntellisense"], function (require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var Mirror = require("../worker/mirror").Mirror;
var JSONParser = require('./json/jsonParser').JSONParser;
var Json = require('./json/json');
var JsonIntellisense = require('./json/jsonIntellisense').JsonIntellisense;

var JsonWorker = exports.JsonWorker = function (sender) {
    Mirror.call(this, sender);
    this.setTimeout(200);
    this.jsonParser = new JSONParser();
    this.jsonIntellisense = new JsonIntellisense();
    this.delayedCompletions = []
};

oop.inherits(JsonWorker, Mirror);

(function () {
    this.setOptions = function (opts) {
        var schemaText = opts && opts.jsonSchema;
        this.jsonSchema = schemaText && Json.parse(schemaText);
    };

    this.getCompletionsCore = function (pos, prefix, callbackIds) {
        var jsonDocument = this.jsonDocument,
            jsonSchema = this.jsonSchema,
            doc = this.doc,
            that = this;

        if (!jsonDocument)
            return false;

        this.jsonIntellisense.suggest(jsonDocument, jsonSchema, doc, pos, prefix, function (suggestions) {
            for (var i = 0; i < callbackIds.length; i++) {
                that.sender.callback(suggestions, callbackIds[i]);
            }
        })
    };

    this.getCompletions = function (pos, prefix, callbackId) {
        if (this.isPending()) {
            this.delayedCompletions.push({ pos: pos, prefix: prefix, callbackId: callbackId });
        } else {
            this.getCompletionsCore(pos, prefix, [callbackId]);
        }
    };

    this.onUpdate = function () {
        var jsonSchema = this.jsonSchema,
            doc = this.doc,
            value = doc.getValue(),
            errors = [],
            delayedCompletions = this.delayedCompletions;
        this.jsonDocument = null;
        if (value) {
            var document = this.jsonParser.parse(value, {
                ignoreDanglingComma: false
            });
            if (jsonSchema) {
                document.validate(jsonSchema);
            }
            document.errors.forEach(function (error) {
                var pos = doc.indexToPosition(error.location.start);
                errors.push({
                    row: pos.row,
                    column: pos.column,
                    text: error.message,
                    type: "error"
                });
            })
            document.warnings.forEach(function (error) {
                var pos = doc.indexToPosition(error.location.start);
                errors.push({
                    row: pos.row,
                    column: pos.column,
                    text: error.message,
                    type: "warning"
                });
            })
            this.jsonDocument = document;

            if (delayedCompletions.length) {
                var callbackIds = delayedCompletions.map(function (x) { return x.callbackId })
                var currentCompletion = delayedCompletions[delayedCompletions.length - 1];
                this.getCompletionsCore(currentCompletion.pos, currentCompletion.prefix, callbackIds)
                this.delayedCompletions = []
            }
        }
        this.sender.emit("annotate", errors);
    };

}).call(JsonWorker.prototype);

});

ace.define("ace/lib/es5-shim",["require","exports","module"], function(require, exports, module) {

function Empty() {}

if (!Function.prototype.bind) {
    Function.prototype.bind = function bind(that) { // .length is 1
        var target = this;
        if (typeof target != "function") {
            throw new TypeError("Function.prototype.bind called on incompatible " + target);
        }
        var args = slice.call(arguments, 1); // for normal call
        var bound = function () {

            if (this instanceof bound) {

                var result = target.apply(
                    this,
                    args.concat(slice.call(arguments))
                );
                if (Object(result) === result) {
                    return result;
                }
                return this;

            } else {
                return target.apply(
                    that,
                    args.concat(slice.call(arguments))
                );

            }

        };
        if(target.prototype) {
            Empty.prototype = target.prototype;
            bound.prototype = new Empty();
            Empty.prototype = null;
        }
        return bound;
    };
}
var call = Function.prototype.call;
var prototypeOfArray = Array.prototype;
var prototypeOfObject = Object.prototype;
var slice = prototypeOfArray.slice;
var _toString = call.bind(prototypeOfObject.toString);
var owns = call.bind(prototypeOfObject.hasOwnProperty);
var defineGetter;
var defineSetter;
var lookupGetter;
var lookupSetter;
var supportsAccessors;
if ((supportsAccessors = owns(prototypeOfObject, "__defineGetter__"))) {
    defineGetter = call.bind(prototypeOfObject.__defineGetter__);
    defineSetter = call.bind(prototypeOfObject.__defineSetter__);
    lookupGetter = call.bind(prototypeOfObject.__lookupGetter__);
    lookupSetter = call.bind(prototypeOfObject.__lookupSetter__);
}
if ([1,2].splice(0).length != 2) {
    if(function() { // test IE < 9 to splice bug - see issue #138
        function makeArray(l) {
            var a = new Array(l+2);
            a[0] = a[1] = 0;
            return a;
        }
        var array = [], lengthBefore;
        
        array.splice.apply(array, makeArray(20));
        array.splice.apply(array, makeArray(26));

        lengthBefore = array.length; //46
        array.splice(5, 0, "XXX"); // add one element

        lengthBefore + 1 == array.length

        if (lengthBefore + 1 == array.length) {
            return true;// has right splice implementation without bugs
        }
    }()) {//IE 6/7
        var array_splice = Array.prototype.splice;
        Array.prototype.splice = function(start, deleteCount) {
            if (!arguments.length) {
                return [];
            } else {
                return array_splice.apply(this, [
                    start === void 0 ? 0 : start,
                    deleteCount === void 0 ? (this.length - start) : deleteCount
                ].concat(slice.call(arguments, 2)))
            }
        };
    } else {//IE8
        Array.prototype.splice = function(pos, removeCount){
            var length = this.length;
            if (pos > 0) {
                if (pos > length)
                    pos = length;
            } else if (pos == void 0) {
                pos = 0;
            } else if (pos < 0) {
                pos = Math.max(length + pos, 0);
            }

            if (!(pos+removeCount < length))
                removeCount = length - pos;

            var removed = this.slice(pos, pos+removeCount);
            var insert = slice.call(arguments, 2);
            var add = insert.length;            
            if (pos === length) {
                if (add) {
                    this.push.apply(this, insert);
                }
            } else {
                var remove = Math.min(removeCount, length - pos);
                var tailOldPos = pos + remove;
                var tailNewPos = tailOldPos + add - remove;
                var tailCount = length - tailOldPos;
                var lengthAfterRemove = length - remove;

                if (tailNewPos < tailOldPos) { // case A
                    for (var i = 0; i < tailCount; ++i) {
                        this[tailNewPos+i] = this[tailOldPos+i];
                    }
                } else if (tailNewPos > tailOldPos) { // case B
                    for (i = tailCount; i--; ) {
                        this[tailNewPos+i] = this[tailOldPos+i];
                    }
                } // else, add == remove (nothing to do)

                if (add && pos === lengthAfterRemove) {
                    this.length = lengthAfterRemove; // truncate array
                    this.push.apply(this, insert);
                } else {
                    this.length = lengthAfterRemove + add; // reserves space
                    for (i = 0; i < add; ++i) {
                        this[pos+i] = insert[i];
                    }
                }
            }
            return removed;
        };
    }
}
if (!Array.isArray) {
    Array.isArray = function isArray(obj) {
        return _toString(obj) == "[object Array]";
    };
}
var boxedString = Object("a"),
    splitString = boxedString[0] != "a" || !(0 in boxedString);

if (!Array.prototype.forEach) {
    Array.prototype.forEach = function forEach(fun /*, thisp*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            thisp = arguments[1],
            i = -1,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(); // TODO message
        }

        while (++i < length) {
            if (i in self) {
                fun.call(thisp, self[i], i, object);
            }
        }
    };
}
if (!Array.prototype.map) {
    Array.prototype.map = function map(fun /*, thisp*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            result = Array(length),
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self)
                result[i] = fun.call(thisp, self[i], i, object);
        }
        return result;
    };
}
if (!Array.prototype.filter) {
    Array.prototype.filter = function filter(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                    object,
            length = self.length >>> 0,
            result = [],
            value,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self) {
                value = self[i];
                if (fun.call(thisp, value, i, object)) {
                    result.push(value);
                }
            }
        }
        return result;
    };
}
if (!Array.prototype.every) {
    Array.prototype.every = function every(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && !fun.call(thisp, self[i], i, object)) {
                return false;
            }
        }
        return true;
    };
}
if (!Array.prototype.some) {
    Array.prototype.some = function some(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && fun.call(thisp, self[i], i, object)) {
                return true;
            }
        }
        return false;
    };
}
if (!Array.prototype.reduce) {
    Array.prototype.reduce = function reduce(fun /*, initial*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }
        if (!length && arguments.length == 1) {
            throw new TypeError("reduce of empty array with no initial value");
        }

        var i = 0;
        var result;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i++];
                    break;
                }
                if (++i >= length) {
                    throw new TypeError("reduce of empty array with no initial value");
                }
            } while (true);
        }

        for (; i < length; i++) {
            if (i in self) {
                result = fun.call(void 0, result, self[i], i, object);
            }
        }

        return result;
    };
}
if (!Array.prototype.reduceRight) {
    Array.prototype.reduceRight = function reduceRight(fun /*, initial*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }
        if (!length && arguments.length == 1) {
            throw new TypeError("reduceRight of empty array with no initial value");
        }

        var result, i = length - 1;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i--];
                    break;
                }
                if (--i < 0) {
                    throw new TypeError("reduceRight of empty array with no initial value");
                }
            } while (true);
        }

        do {
            if (i in this) {
                result = fun.call(void 0, result, self[i], i, object);
            }
        } while (i--);

        return result;
    };
}
if (!Array.prototype.indexOf || ([0, 1].indexOf(1, 2) != -1)) {
    Array.prototype.indexOf = function indexOf(sought /*, fromIndex */ ) {
        var self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }

        var i = 0;
        if (arguments.length > 1) {
            i = toInteger(arguments[1]);
        }
        i = i >= 0 ? i : Math.max(0, length + i);
        for (; i < length; i++) {
            if (i in self && self[i] === sought) {
                return i;
            }
        }
        return -1;
    };
}
if (!Array.prototype.lastIndexOf || ([0, 1].lastIndexOf(0, -3) != -1)) {
    Array.prototype.lastIndexOf = function lastIndexOf(sought /*, fromIndex */) {
        var self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }
        var i = length - 1;
        if (arguments.length > 1) {
            i = Math.min(i, toInteger(arguments[1]));
        }
        i = i >= 0 ? i : length - Math.abs(i);
        for (; i >= 0; i--) {
            if (i in self && sought === self[i]) {
                return i;
            }
        }
        return -1;
    };
}
if (!Object.getPrototypeOf) {
    Object.getPrototypeOf = function getPrototypeOf(object) {
        return object.__proto__ || (
            object.constructor ?
            object.constructor.prototype :
            prototypeOfObject
        );
    };
}
if (!Object.getOwnPropertyDescriptor) {
    var ERR_NON_OBJECT = "Object.getOwnPropertyDescriptor called on a " +
                         "non-object: ";
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(object, property) {
        if ((typeof object != "object" && typeof object != "function") || object === null)
            throw new TypeError(ERR_NON_OBJECT + object);
        if (!owns(object, property))
            return;

        var descriptor, getter, setter;
        descriptor =  { enumerable: true, configurable: true };
        if (supportsAccessors) {
            var prototype = object.__proto__;
            object.__proto__ = prototypeOfObject;

            var getter = lookupGetter(object, property);
            var setter = lookupSetter(object, property);
            object.__proto__ = prototype;

            if (getter || setter) {
                if (getter) descriptor.get = getter;
                if (setter) descriptor.set = setter;
                return descriptor;
            }
        }
        descriptor.value = object[property];
        return descriptor;
    };
}
if (!Object.getOwnPropertyNames) {
    Object.getOwnPropertyNames = function getOwnPropertyNames(object) {
        return Object.keys(object);
    };
}
if (!Object.create) {
    var createEmpty;
    if (Object.prototype.__proto__ === null) {
        createEmpty = function () {
            return { "__proto__": null };
        };
    } else {
        createEmpty = function () {
            var empty = {};
            for (var i in empty)
                empty[i] = null;
            empty.constructor =
            empty.hasOwnProperty =
            empty.propertyIsEnumerable =
            empty.isPrototypeOf =
            empty.toLocaleString =
            empty.toString =
            empty.valueOf =
            empty.__proto__ = null;
            return empty;
        }
    }

    Object.create = function create(prototype, properties) {
        var object;
        if (prototype === null) {
            object = createEmpty();
        } else {
            if (typeof prototype != "object")
                throw new TypeError("typeof prototype["+(typeof prototype)+"] != 'object'");
            var Type = function () {};
            Type.prototype = prototype;
            object = new Type();
            object.__proto__ = prototype;
        }
        if (properties !== void 0)
            Object.defineProperties(object, properties);
        return object;
    };
}

function doesDefinePropertyWork(object) {
    try {
        Object.defineProperty(object, "sentinel", {});
        return "sentinel" in object;
    } catch (exception) {
    }
}
if (Object.defineProperty) {
    var definePropertyWorksOnObject = doesDefinePropertyWork({});
    var definePropertyWorksOnDom = typeof document == "undefined" ||
        doesDefinePropertyWork(document.createElement("div"));
    if (!definePropertyWorksOnObject || !definePropertyWorksOnDom) {
        var definePropertyFallback = Object.defineProperty;
    }
}

if (!Object.defineProperty || definePropertyFallback) {
    var ERR_NON_OBJECT_DESCRIPTOR = "Property description must be an object: ";
    var ERR_NON_OBJECT_TARGET = "Object.defineProperty called on non-object: "
    var ERR_ACCESSORS_NOT_SUPPORTED = "getters & setters can not be defined " +
                                      "on this javascript engine";

    Object.defineProperty = function defineProperty(object, property, descriptor) {
        if ((typeof object != "object" && typeof object != "function") || object === null)
            throw new TypeError(ERR_NON_OBJECT_TARGET + object);
        if ((typeof descriptor != "object" && typeof descriptor != "function") || descriptor === null)
            throw new TypeError(ERR_NON_OBJECT_DESCRIPTOR + descriptor);
        if (definePropertyFallback) {
            try {
                return definePropertyFallback.call(Object, object, property, descriptor);
            } catch (exception) {
            }
        }
        if (owns(descriptor, "value")) {

            if (supportsAccessors && (lookupGetter(object, property) ||
                                      lookupSetter(object, property)))
            {
                var prototype = object.__proto__;
                object.__proto__ = prototypeOfObject;
                delete object[property];
                object[property] = descriptor.value;
                object.__proto__ = prototype;
            } else {
                object[property] = descriptor.value;
            }
        } else {
            if (!supportsAccessors)
                throw new TypeError(ERR_ACCESSORS_NOT_SUPPORTED);
            if (owns(descriptor, "get"))
                defineGetter(object, property, descriptor.get);
            if (owns(descriptor, "set"))
                defineSetter(object, property, descriptor.set);
        }

        return object;
    };
}
if (!Object.defineProperties) {
    Object.defineProperties = function defineProperties(object, properties) {
        for (var property in properties) {
            if (owns(properties, property))
                Object.defineProperty(object, property, properties[property]);
        }
        return object;
    };
}
if (!Object.seal) {
    Object.seal = function seal(object) {
        return object;
    };
}
if (!Object.freeze) {
    Object.freeze = function freeze(object) {
        return object;
    };
}
try {
    Object.freeze(function () {});
} catch (exception) {
    Object.freeze = (function freeze(freezeObject) {
        return function freeze(object) {
            if (typeof object == "function") {
                return object;
            } else {
                return freezeObject(object);
            }
        };
    })(Object.freeze);
}
if (!Object.preventExtensions) {
    Object.preventExtensions = function preventExtensions(object) {
        return object;
    };
}
if (!Object.isSealed) {
    Object.isSealed = function isSealed(object) {
        return false;
    };
}
if (!Object.isFrozen) {
    Object.isFrozen = function isFrozen(object) {
        return false;
    };
}
if (!Object.isExtensible) {
    Object.isExtensible = function isExtensible(object) {
        if (Object(object) === object) {
            throw new TypeError(); // TODO message
        }
        var name = '';
        while (owns(object, name)) {
            name += '?';
        }
        object[name] = true;
        var returnValue = owns(object, name);
        delete object[name];
        return returnValue;
    };
}
if (!Object.keys) {
    var hasDontEnumBug = true,
        dontEnums = [
            "toString",
            "toLocaleString",
            "valueOf",
            "hasOwnProperty",
            "isPrototypeOf",
            "propertyIsEnumerable",
            "constructor"
        ],
        dontEnumsLength = dontEnums.length;

    for (var key in {"toString": null}) {
        hasDontEnumBug = false;
    }

    Object.keys = function keys(object) {

        if (
            (typeof object != "object" && typeof object != "function") ||
            object === null
        ) {
            throw new TypeError("Object.keys called on a non-object");
        }

        var keys = [];
        for (var name in object) {
            if (owns(object, name)) {
                keys.push(name);
            }
        }

        if (hasDontEnumBug) {
            for (var i = 0, ii = dontEnumsLength; i < ii; i++) {
                var dontEnum = dontEnums[i];
                if (owns(object, dontEnum)) {
                    keys.push(dontEnum);
                }
            }
        }
        return keys;
    };

}
if (!Date.now) {
    Date.now = function now() {
        return new Date().getTime();
    };
}
var ws = "\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003" +
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028" +
    "\u2029\uFEFF";
if (!String.prototype.trim || ws.trim()) {
    ws = "[" + ws + "]";
    var trimBeginRegexp = new RegExp("^" + ws + ws + "*"),
        trimEndRegexp = new RegExp(ws + ws + "*$");
    String.prototype.trim = function trim() {
        return String(this).replace(trimBeginRegexp, "").replace(trimEndRegexp, "");
    };
}

function toInteger(n) {
    n = +n;
    if (n !== n) { // isNaN
        n = 0;
    } else if (n !== 0 && n !== (1/0) && n !== -(1/0)) {
        n = (n > 0 || -1) * Math.floor(Math.abs(n));
    }
    return n;
}

function isPrimitive(input) {
    var type = typeof input;
    return (
        input === null ||
        type === "undefined" ||
        type === "boolean" ||
        type === "number" ||
        type === "string"
    );
}

function toPrimitive(input) {
    var val, valueOf, toString;
    if (isPrimitive(input)) {
        return input;
    }
    valueOf = input.valueOf;
    if (typeof valueOf === "function") {
        val = valueOf.call(input);
        if (isPrimitive(val)) {
            return val;
        }
    }
    toString = input.toString;
    if (typeof toString === "function") {
        val = toString.call(input);
        if (isPrimitive(val)) {
            return val;
        }
    }
    throw new TypeError();
}
var toObject = function (o) {
    if (o == null) { // this matches both null and undefined
        throw new TypeError("can't convert "+o+" to object");
    }
    return Object(o);
};

});
