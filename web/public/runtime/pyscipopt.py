"""A PySCIPOpt-compatible modelling layer for the in-browser practice runtime.

This exists because the course notebooks are written against PySCIPOpt, which
cannot run in a browser: SCIP is a C++ library and Pyodide has no build of it.
Rather than rewrite eleven notebooks, this module implements the small part of
the PySCIPOpt API they actually use and solves with SciPy's HiGHS backend, which
does run under WebAssembly.

Scope is deliberately narrow: only the symbols and methods the course material
uses are provided. Anything else raises NotImplementedError instead of silently
doing something surprising.

This is the PRACTICE runtime. Formal grading never runs this code: it uses real
PySCIPOpt inside the isolated container, so scores are unaffected.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

__all__ = ["Model", "quicksum", "Variable", "ConstraintError"]

_INF = float("inf")


class ConstraintError(ValueError):
    """A comparison was used outside addCons, or a constraint is malformed."""


class _Expr:
    """An affine expression: {variable index: coefficient} plus a constant."""

    __slots__ = ("coeffs", "const")

    def __init__(self, coeffs=None, const=0.0):
        self.coeffs = dict(coeffs or {})
        self.const = float(const)

    # ---- arithmetic -------------------------------------------------
    def _merge(self, other, sign):
        if isinstance(other, _Expr):
            out = dict(self.coeffs)
            for idx, value in other.coeffs.items():
                out[idx] = out.get(idx, 0.0) + sign * value
            return _Expr(out, self.const + sign * other.const)
        if isinstance(other, (int, float, np.integer, np.floating)):
            return _Expr(self.coeffs, self.const + sign * float(other))
        return NotImplemented

    def __add__(self, other):
        return self._merge(other, 1.0)

    def __radd__(self, other):
        return self._merge(other, 1.0)

    def __sub__(self, other):
        return self._merge(other, -1.0)

    def __rsub__(self, other):
        return (-self)._merge(other, 1.0)

    def __neg__(self):
        return _Expr({k: -v for k, v in self.coeffs.items()}, -self.const)

    def __mul__(self, other):
        if isinstance(other, (int, float, np.integer, np.floating)):
            factor = float(other)
            return _Expr({k: v * factor for k, v in self.coeffs.items()}, self.const * factor)
        return NotImplemented

    def __rmul__(self, other):
        return self.__mul__(other)

    # ---- comparisons ------------------------------------------------
    def __le__(self, other):
        return self._constraint(other, "<=")

    def __ge__(self, other):
        return self._constraint(other, ">=")

    def __eq__(self, other):  # noqa: D105 - mirrors PySCIPOpt's operator style
        return self._constraint(other, "==")

    def __hash__(self):
        # Comparisons here are not equality tests, so identity hashing keeps
        # variables usable as dictionary keys.
        return object.__hash__(self)

    def _constraint(self, other, sense):
        rhs = other if isinstance(other, _Expr) else _Expr({}, float(other))
        coeffs = dict(self.coeffs)
        for idx, value in rhs.coeffs.items():
            coeffs[idx] = coeffs.get(idx, 0.0) - value
        bound = rhs.const - self.const
        return _Constraint(coeffs, sense, bound)

    def __repr__(self):
        return "Expr(" + repr(self.coeffs) + ", const=" + repr(self.const) + ")"


class Variable(_Expr):
    """A single decision variable. Behaves as a one-term expression."""

    __slots__ = ("index", "name", "vtype", "lb", "ub", "obj")

    def __init__(self, index, name, vtype, lb, ub, obj):
        super().__init__({index: 1.0}, 0.0)
        self.index = index
        self.name = name
        self.vtype = vtype
        self.lb = lb
        self.ub = ub
        self.obj = float(obj)

    def __repr__(self):
        return "Variable(" + self.name + ")"


class _Constraint:
    __slots__ = ("coeffs", "sense", "bound")

    def __init__(self, coeffs, sense, bound):
        self.coeffs = coeffs
        self.sense = sense
        self.bound = bound

    def __bool__(self):
        raise ConstraintError(
            "约束表达式不能当作布尔值使用：请传给 model.addCons(...)，不要放在 if 里"
        )


class _Status:
    """Stringifies like PySCIPOpt's status so 'optimal' comparisons keep working."""

    __slots__ = ("name",)

    def __init__(self, name):
        self.name = name

    def __str__(self):
        return self.name

    def __repr__(self):
        return "Status(" + self.name + ")"

    def __eq__(self, other):
        return str(self) == str(other)

    def __hash__(self):
        return hash(self.name)


OPTIMAL = "optimal"
INFEASIBLE = "infeasible"
UNBOUNDED = "unbounded"
INFORUNBOUND = "inforunbound"
NODELIMIT = "nodelimit"
TIMELIMIT = "timelimit"

_SCIP_STATUS_BY_MILP = {
    0: OPTIMAL,
    1: TIMELIMIT,
    2: INFEASIBLE,
    3: UNBOUNDED,
    4: NODELIMIT,
}


def _as_expr(value):
    if isinstance(value, _Expr):
        return value
    return _Expr({}, float(value))


def quicksum(terms):
    """Sum an iterable of expressions, like pyscipopt.quicksum."""
    total = _Expr()
    for term in terms:
        total = total + term
    return total


class Model:
    """The subset of pyscipopt.Model the course notebooks use."""

    def __init__(self, name="model"):
        self.name = name
        self._vars: list[Variable] = []
        self._cons: list[_Constraint] = []
        self._objective = _Expr()
        self._sense = "minimize"
        self._solution: dict[int, float] = {}
        self._status = "unknown"
        self._objval = None
        self._verbose = True

    # ---- building ---------------------------------------------------
    def hideOutput(self, flag=True):
        self._verbose = not flag

    def addVar(self, name="", vtype="C", lb=0.0, ub=None, obj=0.0):
        if vtype not in ("C", "B", "I"):
            raise NotImplementedError("暂不支持变量类型 " + str(vtype))
        if vtype == "B":
            lb, ub = 0.0, 1.0
        if ub is None:
            ub = _INF
        var = Variable(len(self._vars), name or ("x" + str(len(self._vars))), vtype, lb, ub, obj)
        self._vars.append(var)
        return var

    def addCons(self, cons, name=""):
        if not isinstance(cons, _Constraint):
            raise ConstraintError("addCons 需要 a <= b、a >= b 或 a == b 形式的约束")
        self._cons.append(cons)

    def setObjective(self, expr, sense="minimize"):
        if sense not in ("minimize", "maximize"):
            raise ValueError("目标方向必须是 minimize 或 maximize")
        self._objective = _as_expr(expr)
        self._sense = sense

    def setMinimize(self):
        self._sense = "minimize"

    def setMaximize(self):
        self._sense = "maximize"

    # ---- solving ----------------------------------------------------
    def optimize(self):
        if not self._vars:
            raise ConstraintError("模型没有任何变量")

        count = len(self._vars)
        c = np.zeros(count)
        for idx, value in self._objective.coeffs.items():
            c[idx] = value
        # HiGHS minimizes; negate for a maximization model.
        if self._sense == "maximize":
            c = -c

        integrality = np.zeros(count)
        lower = np.zeros(count)
        upper = np.zeros(count)
        for var in self._vars:
            integrality[var.index] = 1.0 if var.vtype in ("B", "I") else 0.0
            lower[var.index] = var.lb
            upper[var.index] = var.ub

        rows, lows, highs = [], [], []
        for con in self._cons:
            row = np.zeros(count)
            for idx, value in con.coeffs.items():
                row[idx] = value
            rows.append(row)
            if con.sense == "<=":
                lows.append(-_INF)
                highs.append(con.bound)
            elif con.sense == ">=":
                lows.append(con.bound)
                highs.append(_INF)
            else:
                lows.append(con.bound)
                highs.append(con.bound)

        constraints = [LinearConstraint(np.array(rows), np.array(lows), np.array(highs))] if rows else []
        result = milp(c=c, constraints=constraints, integrality=integrality, bounds=Bounds(lower, upper))

        self._status = _SCIP_STATUS_BY_MILP.get(result.status, "unknown")
        if self._status == OPTIMAL:
            self._solution = {i: float(result.x[i]) for i in range(count)}
            self._objval = float(-result.fun) if self._sense == "maximize" else float(result.fun)
        else:
            self._solution = {}
            self._objval = None

    # ---- querying ---------------------------------------------------
    def getStatus(self):
        return _Status(self._status)

    def getVal(self, expr):
        if not self._solution:
            raise ConstraintError("模型尚未得到可行解，无法读取取值")
        if isinstance(expr, Variable):
            return self._solution[expr.index]
        if isinstance(expr, _Expr):
            return sum(coef * self._solution[i] for i, coef in expr.coeffs.items()) + expr.const
        raise TypeError("getVal 需要单个变量")

    def getObjVal(self):
        if self._objval is None:
            raise ConstraintError("模型尚未得到最优解，无法读取目标值")
        return self._objval

    def getNVars(self):
        return len(self._vars)
