---- MODULE Recipes_TTrace_1793064376 ----
EXTENDS Sequences, TLCExt, Toolbox, Recipes, Naturals, TLC

_expression ==
    LET Recipes_TEExpression == INSTANCE Recipes_TEExpression
    IN Recipes_TEExpression!expression
----

_trace ==
    LET Recipes_TETrace == INSTANCE Recipes_TETrace
    IN Recipes_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        library = (<<[id |-> "f1", text |-> "f1"], [id |-> "f2", text |-> "f1"]>>)
        /\
        form = ("f1")
        /\
        browser = ({"b1", "b2"})
        /\
        cleared = (FALSE)
        /\
        uploads = (<<{}, {}>>)
    )
----

_init ==
    /\ browser = _TETrace[1].browser
    /\ library = _TETrace[1].library
    /\ uploads = _TETrace[1].uploads
    /\ cleared = _TETrace[1].cleared
    /\ form = _TETrace[1].form
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ browser  = _TETrace[i].browser
        /\ browser' = _TETrace[j].browser
        /\ library  = _TETrace[i].library
        /\ library' = _TETrace[j].library
        /\ uploads  = _TETrace[i].uploads
        /\ uploads' = _TETrace[j].uploads
        /\ cleared  = _TETrace[i].cleared
        /\ cleared' = _TETrace[j].cleared
        /\ form  = _TETrace[i].form
        /\ form' = _TETrace[j].form

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("Recipes_TTrace_1793064376.json", _TETrace)

=============================================================================

 Note that you can extract this module `Recipes_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `Recipes_TEExpression.tla` file takes precedence 
  over the module `Recipes_TEExpression` below).

---- MODULE Recipes_TEExpression ----
EXTENDS Sequences, TLCExt, Toolbox, Recipes, Naturals, TLC

expression == 
    [
        \* To hide variables of the `Recipes` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        browser |-> browser
        ,library |-> library
        ,uploads |-> uploads
        ,cleared |-> cleared
        ,form |-> form
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_browserUnchanged |-> browser = browser'
        
        \* Format the `browser` variable as Json value.
        \* ,_browserJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(browser)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_browserModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].browser # _TETrace[s-1].browser
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE Recipes_TETrace ----
\*EXTENDS IOUtils, Recipes, TLC
\*
\*trace == IODeserialize("Recipes_TTrace_1793064376.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE Recipes_TETrace ----
EXTENDS Recipes, TLC

trace == 
    <<
    ([library |-> <<>>,form |-> "f1",browser |-> {"b1", "b2"},cleared |-> FALSE,uploads |-> <<{}, {}>>]),
    ([library |-> <<[id |-> "f1", text |-> "f1"]>>,form |-> "f1",browser |-> {"b1", "b2"},cleared |-> FALSE,uploads |-> <<{}, {}>>]),
    ([library |-> <<[id |-> "f1", text |-> "f1"], [id |-> "f2", text |-> "f1"]>>,form |-> "f1",browser |-> {"b1", "b2"},cleared |-> FALSE,uploads |-> <<{}, {}>>])
    >>
----


=============================================================================

---- CONFIG Recipes_TTrace_1793064376 ----
CONSTANTS
    Forms = { "f1" , "f2" }
    BrowserRecipes = { "b1" , "b2" }
    DocumentIds = { "f1" , "f2" , "b1" , "b2" }
    FreshIdOnEveryWrite = TRUE
    ClearBeforeUpload = FALSE

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Tue Oct 27 01:26:17 UTC 2026