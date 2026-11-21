# kotlinx.serialization ships its own R8 rules; the models only need their
# generated serializers kept, which those rules already do. Nothing else here
# is reached by reflection.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
