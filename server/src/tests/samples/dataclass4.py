# This sample tests the handling of the @dataclass decorator.

from dataclasses import dataclass, InitVar

@dataclass
class Bar():
    bbb: int
    ccc: str
    aaa = 'string'

bar1 = Bar(bbb=5, ccc='hello')
bar2 = Bar(5, 'hello')
bar3 = Bar(5, 'hello', 'hello2')
print(bar3.bbb)
print(bar3.ccc)
print(bar3.aaa)

# This should generate an error because ddd
# isn't a declared value.
bar = Bar(bbb=5, ddd=5, ccc='hello')

# This should generate an error because the
# pramater types don't match.
bar = Bar('hello', 'goodbye')

# This should generate an error because a parameter
# is missing.
bar = Bar(2)

# This should generate an error because there are
# too many parameters.
bar = Bar(2, 'hello', 'hello', 4)


@dataclass
class Baz1():
    bbb: int
    aaa = 'string'

    # This should generate an error because variables
    # with no default cannot come after those with
    # defaults.
    ccc: str

@dataclass
class Baz2():
    aaa: str
    ddd: InitVar[int] = 3

